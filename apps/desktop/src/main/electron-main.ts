import { join, resolve } from 'node:path';

import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';

import {
  DESKTOP_IPC_REQUEST_CHANNELS,
  type DesktopIpcEventChannel,
} from '../shared/desktop-ipc-channels.js';
import { DesktopWindowRegistry, createBrowserWindowOptions } from './electron-window.js';
import { TerminalHost } from './terminal-host.js';

const windows = new DesktopWindowRegistry<BrowserWindow>();

const userDataOverride = process.env.SYNAPSE_TERM_USER_DATA_DIR?.trim();
if (userDataOverride !== undefined && userDataOverride.length > 0) {
  app.setPath('userData', resolve(userDataOverride));
}

function createWindow(): void {
  const directory = join(app.getAppPath(), 'dist/main');
  const preloadPath = join(directory, '../preload/preload.cjs');
  const window = windows.retain(new BrowserWindow(createBrowserWindowOptions(preloadPath)));
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[desktop-main] renderer-gone', details);
  });
  window.setMenuBarVisibility(false);
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === 'https:' || target.protocol === 'http:') {
        void shell.openExternal(target.href).catch(() => undefined);
      }
    } catch {
      // Invalid and non-web URLs remain blocked inside the renderer boundary.
    }
    return { action: 'deny' };
  });
  const developmentUrl = process.env.SYNAPSE_TERM_RENDERER_URL;
  if (developmentUrl !== undefined) void window.loadURL(developmentUrl);
  else void window.loadFile(join(directory, '../renderer/index.html'));
}

function registerIpc(host: TerminalHost): void {
  for (const channel of DESKTOP_IPC_REQUEST_CHANNELS) {
    ipcMain.handle(channel, (event, ...argumentsValue: unknown[]) => {
      if (!isTrustedRendererEvent(event)) {
        throw new Error('Renderer IPC request is not trusted');
      }
      return host.handle(channel, argumentsValue);
    });
  }
}

function isTrustedRendererEvent(event: Electron.IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url;
  if (typeof url !== 'string' || url.length === 0) return false;
  if (url.startsWith('file://')) return true;
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && parsed.port === '4173'
    );
  } catch {
    return false;
  }
}

function broadcast(channel: DesktopIpcEventChannel, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

async function startDesktopMain(): Promise<void> {
  app.commandLine.appendSwitch('in-process-gpu');
  app.disableHardwareAcceleration();
  await app.whenReady();
  Menu.setApplicationMenu(null);

  const host = new TerminalHost({ version: app.getVersion() });
  const removeSessionListener = host.onSessionChanged((session) =>
    broadcast('session:changed', session),
  );
  const removeOutputListener = host.onTerminalOutput((event) =>
    broadcast('terminal:output', event),
  );
  registerIpc(host);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void host
      .shutdown()
      .catch((error: unknown) => console.error('[desktop-main] shutdown failed', error))
      .finally(() => {
        removeSessionListener();
        removeOutputListener();
        app.quit();
      });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

void startDesktopMain().catch((error: unknown) => {
  console.error('[desktop-main] startup failed', error);
  app.exit(1);
});
