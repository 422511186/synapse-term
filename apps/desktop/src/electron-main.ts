import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { CURRENT_PROTOCOL_VERSION } from '@terminal-agent/protocol';
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';

import { getDesktopCoreConfig } from './core-config.js';
import { NodeCoreProcessLauncher } from './core-process.js';
import { CoreSupervisor } from './core-supervisor.js';
import { createDesktopCoreBridge, type DesktopCoreBridge } from './desktop-core-bridge.js';
import {
  DESKTOP_IPC_REQUEST_CHANNELS,
  type DesktopIpcEventChannel,
} from './desktop-ipc-channels.js';
import { DesktopWindowRegistry, createBrowserWindowOptions } from './electron-window.js';
import { NamedPipeCoreConnector } from './named-pipe-core-connector.js';
import { ShellLocator } from './shell-locator.js';

const require = createRequire(import.meta.url);
const APP_ID = 'terminal-agent';
const userDataOverride = process.env.TERMINAL_AGENT_USER_DATA_DIR?.trim();
if (userDataOverride) app.setPath('userData', resolve(userDataOverride));
const windows = new DesktopWindowRegistry<BrowserWindow>();
const debug = (...values: unknown[]): void => {
  if (process.env.TERMINAL_AGENT_DEBUG === '1') console.error('[desktop-main]', ...values);
};
function createWindow(): BrowserWindow {
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
  const developmentUrl = process.env.TERMINAL_AGENT_RENDERER_URL;
  if (developmentUrl !== undefined) void window.loadURL(developmentUrl);
  else void window.loadFile(join(directory, '../renderer/index.html'));
  return window;
}

function registerIpc(bridge: DesktopCoreBridge): void {
  for (const channel of DESKTOP_IPC_REQUEST_CHANNELS) {
    ipcMain.handle(channel, (_event, ...argumentsValue: unknown[]) =>
      bridge.invoke(channel, ...argumentsValue),
    );
  }
}

function broadcast(channel: DesktopIpcEventChannel, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

function createSupervisor(): CoreSupervisor {
  const username = userInfo().username;
  const appId = process.env.TERMINAL_AGENT_APP_ID?.trim() || APP_ID;
  const dataDirectory = join(app.getPath('userData'), 'core');
  const config = getDesktopCoreConfig(dataDirectory, appId, username);
  const instanceId = randomUUID();
  const launch = resolveCoreLaunch(dataDirectory, appId, username, instanceId);
  return new CoreSupervisor({
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    connector: new NamedPipeCoreConnector({
      pipeName: config.pipeName,
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      clientInstanceId: randomUUID(),
      loadToken: () => loadToken(config.tokenPath),
      requestTimeoutMs: 75_000,
    }),
    launcher: new NodeCoreProcessLauncher(launch),
  });
}

function resolveCoreLaunch(
  dataDirectory: string,
  appId: string,
  username: string,
  instanceId: string,
): ConstructorParameters<typeof NodeCoreProcessLauncher>[0] {
  const packagedEntry = join(process.resourcesPath, 'core', 'dist', 'core-main.mjs');
  const developmentEntry = resolve(app.getAppPath(), '../core/src/main.ts');
  const command =
    process.env.TERMINAL_AGENT_CORE_NODE ??
    (app.isPackaged
      ? join(process.resourcesPath, 'core', process.platform === 'win32' ? 'node.exe' : 'node')
      : 'node');
  const entry =
    process.env.TERMINAL_AGENT_CORE_ENTRY ?? (app.isPackaged ? packagedEntry : developmentEntry);
  const args =
    app.isPackaged || process.env.TERMINAL_AGENT_CORE_ENTRY !== undefined
      ? [entry]
      : [require.resolve('tsx/cli'), entry];
  return {
    command,
    args,
    cwd: dirname(entry),
    env: {
      TERMINAL_AGENT_DATA_DIR: dataDirectory,
      TERMINAL_AGENT_APP_ID: appId,
      TERMINAL_AGENT_USERNAME: username,
      TERMINAL_AGENT_INSTANCE_ID: instanceId,
      TERMINAL_AGENT_VERSION: app.getVersion(),
    },
  };
}

async function loadToken(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function startDesktopMain(): Promise<void> {
  app.commandLine.appendSwitch('in-process-gpu');
  app.disableHardwareAcceleration();
  await app.whenReady();
  Menu.setApplicationMenu(null);
  debug('app-ready');
  const supervisor = createSupervisor();
  debug('supervisor-created');
  const bridge = createDesktopCoreBridge(
    supervisor,
    (event) => broadcast('terminal:output', event),
    (event) => broadcast('agent:timeline', event),
    process.env,
    () => ({ home: app.getPath('home'), shells: new ShellLocator().list() }),
    (event) => broadcast('session:resources', event),
    (event) => broadcast('session:changed', event),
  );
  registerIpc(bridge);
  debug('ipc-registered');
  await supervisor.connect().then(
    (result) => debug('core-connect', result),
    (error: unknown) => debug('core-connect-error', error),
  );
  createWindow();
  debug('window-created');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void supervisor
      .requestExit('terminate_all')
      .catch((error: unknown) => debug('core-shutdown-error', error))
      .finally(() => {
        bridge.dispose();
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
