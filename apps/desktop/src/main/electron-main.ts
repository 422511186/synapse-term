import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron';
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
import { DesktopLifecycle } from './desktop-lifecycle.js';
import type { UpdateAdapter } from './updates/update-adapter.js';
import { UpdateController } from './updates/update-controller.js';
import { handleUpdateRequest } from './updates/update-ipc-adapter.js';
import { updatePreferences } from './updates/update-preferences.js';
import { MacosUpdateAdapter } from './updates/macos-update-adapter.js';
import { SparkleProcess } from './updates/sparkle-process.js';

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
  lifecycle: DesktopLifecycle,
): void {
  for (const channel of DESKTOP_IPC_REQUEST_CHANNELS.filter(
    (channel) =>
      !channel.startsWith('mcp:') &&
      !channel.startsWith('settings:') &&
      !channel.startsWith('updates:') &&
      !channel.startsWith('theme:'),
  )) {
    ipcMain.handle(channel, (event, ...argumentsValue: unknown[]) => {
      if (!isTrustedRendererEvent(event)) {
        throw new Error('Renderer IPC request is not trusted');
      }
      if (channel === 'sessions:create')
        return lifecycle.createSession(() => sessionIpc.handle(channel, argumentsValue));
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
  if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame)
    return false;
  const url = event.senderFrame?.url;
  if (typeof url !== 'string' || url.length === 0) return false;
  try {
    const parsed = new URL(url);
    const directory = import.meta.dirname ?? join(app.getAppPath(), 'dist/main');
    const expected = new URL(
      !app.isPackaged && process.env.SYNAPSE_TERM_RENDERER_URL
        ? process.env.SYNAPSE_TERM_RENDERER_URL
        : pathToFileURL(join(directory, '../renderer/index.html')).href,
    );
    return (
      parsed.protocol === expected.protocol &&
      parsed.host === expected.host &&
      parsed.pathname === expected.pathname
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

function registerMcpIpc(controller: McpController, lifecycle: DesktopLifecycle): void {
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
      if (lifecycle.closing) throw new Error('应用正在退出');
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
  const lifecycle = new DesktopLifecycle({
    stopMcp: () => mcpController.stop(),
    stopSessions: () => sessionRuntime.shutdown(),
  });
  const mcpEndpoint = new EmbeddedMcpServer({
    getSettings: () => mcpController.getSettingsSnapshot(),
    callTool: (name, input) => {
      if (lifecycle.closing) throw new Error('SESSION_EXPIRED: 应用正在退出');
      return mcpController.callTool(name, input);
    },
  });
  mcpController.setEndpoint(mcpEndpoint);
  await mcpController.reload().catch((error: unknown) => {
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
  const preferences = updatePreferences(join(app.getPath('userData'), 'settings'));
  let adapter: UpdateAdapter | null = null;
  if (app.isPackaged && process.platform === 'win32' && process.arch === 'x64') {
    const { WindowsUpdateAdapter } = await import('./updates/windows-update-adapter.js');
    adapter = new WindowsUpdateAdapter(app.getVersion(), () =>
      dialog.showErrorBox(
        'Synapse Term 更新失败',
        '安装器启动失败。已结束的 Session 无法恢复，请重新打开应用检查版本，或从 GitHub Releases 手动下载安装。',
      ),
    );
  } else if (app.isPackaged && process.platform === 'darwin' && process.arch === 'arm64') {
    adapter = new MacosUpdateAdapter({
      currentVersion: app.getVersion(),
      cacheDirectory: join(app.getPath('userData'), 'updates'),
      native: new SparkleProcess(
        join(process.resourcesPath, '../Helpers/SynapseUpdater.app/Contents/MacOS/SynapseUpdater'),
        () => app.quit(),
      ),
    });
  }
  const updates = new UpdateController({
    currentVersion: app.getVersion(),
    adapter,
    automaticChecks: await preferences.load(),
    saveAutomaticChecks: preferences.save,
    unsupportedReason: app.isPackaged ? '当前平台或架构不支持应用内更新' : '开发模式不执行应用更新',
    getSessionIds: () => {
      if (lifecycle.creatingSession) throw new Error('Session 正在创建，请完成后重新确认');
      return sessionRuntime
        .listSessions()
        .filter((session) => session.pty === 'running' || session.pty === 'starting')
        .map((session) => session.id);
    },
    shutdownForInstall: () => lifecycle.shutdown(),
  });
  updates.onChanged((state) => broadcast('updates:changed', state));
  for (const channel of DESKTOP_IPC_REQUEST_CHANNELS.filter((item) =>
    item.startsWith('updates:'),
  )) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!isTrustedRendererEvent(event)) throw new Error('Renderer IPC request is not trusted');
      return handleUpdateRequest(updates, channel, args);
    });
  }
  registerIpc(sessionIpc, generalSettings, lifecycle);
  registerMcpIpc(mcpController, lifecycle);
  createWindow();

  app.on('activate', () => {
    if (!lifecycle.closing && BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  let quitting = false;
  let cleanupComplete = false;
  app.on('before-quit', (event) => {
    if (cleanupComplete) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void Promise.allSettled([updates.dispose(), lifecycle.shutdown()]).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected')
          console.error('[desktop-main] shutdown failed', result.reason);
      }
      nativeTheme.removeListener('updated', handleThemeUpdated);
      removeSessionListener();
      removeOutputListener();
      removeApprovalListener();
      removeApprovalClosedListener();
      removeExecutionListener();
      cleanupComplete = true;
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
