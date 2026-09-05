import { join, resolve } from 'node:path';

import { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell } from 'electron';
import { ApprovalQueue, EmbeddedMcpServer, McpController } from '@synapse-term/mcp-runtime';
import { SessionRuntime } from '@synapse-term/session-runtime';

import type { GeneralSettings, ThemeState } from '../shared/contracts.js';
import {
  DESKTOP_IPC_REQUEST_CHANNELS,
  type DesktopIpcEventChannel,
} from '../shared/desktop-ipc-channels.js';
import { DesktopWindowRegistry, createBrowserWindowOptions } from './electron-window.js';
import { resolveWindowBackgroundColor } from './electron-window.js';
import { GeneralSettingsController } from './settings/general-settings-controller.js';
import { sanitizeGeneralSettings } from './settings/general-settings.js';
import { SessionIpcAdapter } from './session-ipc-adapter.js';

const windows = new DesktopWindowRegistry<BrowserWindow>();

const userDataOverride = process.env.SYNAPSE_TERM_USER_DATA_DIR?.trim();
if (userDataOverride !== undefined && userDataOverride.length > 0) {
  app.setPath('userData', resolve(userDataOverride));
}

// The most recently applied general settings; used to rebuild ThemeState when the
// operating system appearance changes while the theme is set to follow the system.
let appliedGeneralSettings: GeneralSettings = sanitizeGeneralSettings(undefined);

function buildThemeState(settings: GeneralSettings): ThemeState {
  return {
    mode: settings.themeMode,
    scheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    customTheme: settings.customTheme,
  };
}

function applyTheme(settings: GeneralSettings): void {
  appliedGeneralSettings = settings;
  nativeTheme.themeSource = settings.themeMode;
  const scheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.setBackgroundColor(resolveWindowBackgroundColor(scheme));
  }
  broadcast('theme:changed', buildThemeState(settings));
}

function createWindow(): void {
  const directory = import.meta.dirname ?? join(app.getAppPath(), 'dist/main');
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

function registerIpc(
  sessionIpc: SessionIpcAdapter,
  generalSettings: GeneralSettingsController,
): void {
  for (const channel of DESKTOP_IPC_REQUEST_CHANNELS.filter(
    (channel) =>
      !channel.startsWith('mcp:') &&
      !channel.startsWith('settings:') &&
      !channel.startsWith('theme:'),
  )) {
    ipcMain.handle(channel, (event, ...argumentsValue: unknown[]) => {
      if (!isTrustedRendererEvent(event)) {
        throw new Error('Renderer IPC request is not trusted');
      }
      return sessionIpc.handle(channel, argumentsValue);
    });
  }
  ipcMain.handle('settings:get-general', async (event) => {
    if (!isTrustedRendererEvent(event)) throw new Error('Renderer IPC request is not trusted');
    return generalSettings.getSettings();
  });
  ipcMain.handle('settings:update-general', async (event, patch: unknown) => {
    if (!isTrustedRendererEvent(event)) throw new Error('Renderer IPC request is not trusted');
    return generalSettings.updateSettings(
      typeof patch === 'object' && patch !== null ? (patch as Partial<GeneralSettings>) : {},
    );
  });
  ipcMain.handle('theme:get-state', async (event) => {
    if (!isTrustedRendererEvent(event)) throw new Error('Renderer IPC request is not trusted');
    return buildThemeState(appliedGeneralSettings);
  });
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
    if (window.isDestroyed()) continue;
    if (channel === 'mcp:approval') {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      window.flashFrame(true);
    }

    window.webContents.send(channel, payload);
  }
}

function registerMcpIpc(controller: McpController): void {
  const handlers: Record<string, (args: readonly unknown[]) => Promise<unknown> | unknown> = {
    'mcp:get-settings': () => controller.getSettings(),
    'mcp:update-settings': (args) => controller.updateSettings(args[0] as never),
    'mcp:regenerate-token': () => controller.regenerateToken(),
    'mcp:revoke-token': () => controller.revokeToken(),
    'mcp:get-status': () => controller.getStatus(),
    'mcp:list-shared': () => controller.listShared(),
    'mcp:share-session': (args) => controller.share(String(args[0])),
    'mcp:unshare-session': (args) => controller.unshare(String(args[0])),
    'mcp:decide-approval': (args) => controller.decideApproval(String(args[0]), args[1] as never),
  };
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, ...argumentsValue: unknown[]) => {
      if (!isTrustedRendererEvent(event)) throw new Error('Renderer IPC request is not trusted');
      return await handler(argumentsValue);
    });
  }
}

async function startDesktopMain(): Promise<void> {
  app.commandLine.appendSwitch('in-process-gpu');
  app.disableHardwareAcceleration();
  await app.whenReady();
  Menu.setApplicationMenu(null);

  const sessionRuntime = new SessionRuntime({ version: app.getVersion() });
  const sessionIpc = new SessionIpcAdapter(sessionRuntime);
  const generalSettings = new GeneralSettingsController({
    settingsStoreDirectory: join(app.getPath('userData'), 'settings'),
    apply: async (settings) => {
      void sessionRuntime.setProbeEchoVisibility(settings.hideCompletionProbeEcho);
      applyTheme(settings);
    },
  });
  await generalSettings.reload().catch((error: unknown) => {
    console.error('[desktop-settings] general settings load failed', error);
  });
  const handleThemeUpdated = (): void => {
    // Re-emits when the OS appearance changes while the theme follows the system.
    broadcast('theme:changed', buildThemeState(appliedGeneralSettings));
  };
  nativeTheme.on('updated', handleThemeUpdated);
  const approvalTimeoutOverride = process.env.SYNAPSE_TERM_MCP_APPROVAL_TIMEOUT_MS;
  const approvalTimeoutMs = approvalTimeoutOverride ? Number(approvalTimeoutOverride) : 60_000;
  const approvalQueue = new ApprovalQueue({
    timeoutMs:
      Number.isFinite(approvalTimeoutMs) && approvalTimeoutMs > 0 ? approvalTimeoutMs : 60_000,
  });
  const mcpController = new McpController({
    settingsStoreDirectory: join(app.getPath('userData'), 'mcp'),
    sessions: sessionRuntime.getSessionSource(),
    approvalQueue,
  });
  const mcpEndpoint = new EmbeddedMcpServer({
    getSettings: () => mcpController.getSettingsSnapshot(),
    callTool: (name, input) => mcpController.callTool(name, input),
  });
  mcpController.setEndpoint(mcpEndpoint);
  void mcpController.reload().catch((error: unknown) => {
    console.error('[desktop-mcp] settings load failed', error);
  });
  const removeApprovalListener = approvalQueue.onRequest((request) =>
    broadcast('mcp:approval', request),
  );
  const removeApprovalClosedListener = approvalQueue.onResolution((id) =>
    broadcast('mcp:approval-closed', { id }),
  );
  const removeExecutionListener = mcpController.onExecution((event) =>
    broadcast('mcp:execution', event),
  );
  const removeSessionListener = sessionRuntime.onSessionChanged((session) =>
    broadcast('session:changed', session),
  );
  const removeOutputListener = sessionRuntime.onTerminalOutput((event) =>
    broadcast('terminal:output', event),
  );
  registerIpc(sessionIpc, generalSettings);
  registerMcpIpc(mcpController);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void sessionRuntime
      .shutdown()
      .catch((error: unknown) => console.error('[desktop-main] shutdown failed', error))
      .finally(async () => {
        nativeTheme.removeListener('updated', handleThemeUpdated);
        removeSessionListener();
        removeOutputListener();
        removeApprovalListener();
        removeApprovalClosedListener();
        removeExecutionListener();
        await mcpController.stop();
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
