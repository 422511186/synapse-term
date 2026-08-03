import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { CURRENT_PROTOCOL_VERSION } from '@synapse-term/protocol';
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';

import { getDesktopCoreConfig } from './core-config.js';
import { NodeCoreProcessLauncher } from './core-process.js';
import { CoreSupervisor } from './core-supervisor.js';
import { createDesktopCoreBridge, type DesktopCoreBridge } from './desktop-core-bridge.js';
import { createDesktopAttachmentController } from './desktop-attachment-controller.js';
import {
  DESKTOP_ACP_IPC_CHANNELS,
  DESKTOP_MCP_IPC_CHANNELS,
  DESKTOP_IPC_REQUEST_CHANNELS,
  type DesktopIpcEventChannel,
} from '../shared/desktop-ipc-channels.js';
import { DesktopWindowRegistry, createBrowserWindowOptions } from './electron-window.js';
import { createAcpController, type AcpController } from '../acp/acp-controller.js';
import { createMcpController, type McpController } from '../mcp/mcp-controller.js';
import { normalizeMcpApprovalMode } from '../mcp/mcp-settings.js';
import { NamedPipeCoreConnector } from './named-pipe-core-connector.js';
import { ShellLocator } from '@synapse-term/terminal-service/shell-locator';
import { migrateLegacyUserData } from './user-data-migration.js';

const require = createRequire(import.meta.url);
const APP_ID = 'terminal-agent';
const userDataOverride = process.env.TERMINAL_AGENT_USER_DATA_DIR?.trim();
if (userDataOverride) {
  app.setPath('userData', resolve(userDataOverride));
} else {
  // 固定数据目录名，避免随 npm 包名/产品名变化而漂移
  app.setPath('userData', join(app.getPath('appData'), 'synapse-term'));
}
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

/** MCP 端点配置 IPC：桌面本地设置，不经 Core 桥接 */
function registerMcpIpc(controller: McpController): void {
  for (const channel of DESKTOP_MCP_IPC_CHANNELS) {
    ipcMain.handle(channel, (_event, ...argumentsValue: unknown[]) => {
      switch (channel) {
        case 'mcp:get-status':
          return controller.status();
        case 'mcp:set-enabled':
          return controller.setEnabled(argumentsValue[0] === true);
        case 'mcp:set-approval-mode':
          return controller.setApprovalMode(normalizeMcpApprovalMode(argumentsValue[0]));
        case 'mcp:regenerate-token':
          return controller.regenerateToken();
        case 'mcp:revoke-token':
          return controller.revokeToken();
        default:
          throw new Error(`Unknown MCP channel: ${channel}`);
      }
    });
  }
}

/** ACP 外部驱动者 IPC：桌面本地会话控制，不经 Core 桥接 */
function registerAcpIpc(controller: AcpController): void {
  for (const channel of DESKTOP_ACP_IPC_CHANNELS) {
    ipcMain.handle(channel, (_event, ...argumentsValue: unknown[]) => {
      switch (channel) {
        case 'acp:get-status':
          return controller.status();
        case 'acp:set-enabled':
          return controller.setEnabled(argumentsValue[0] === true);
        case 'acp:set-approval-mode':
          return controller.setApprovalMode(argumentsValue[0] === 'manual' ? 'manual' : 'managed');
        case 'acp:start-turn':
          return controller.startTurn(
            String(argumentsValue[0]),
            String(argumentsValue[1]),
            typeof argumentsValue[2] === 'string' ? argumentsValue[2] : undefined,
          );
        case 'acp:cancel-turn':
          return controller.cancelTurn(String(argumentsValue[0]));
        case 'acp:respond-approval':
          return controller.respondApproval(String(argumentsValue[0]), argumentsValue[1] === true);
        case 'acp:close-conversation':
          return controller.closeConversation(String(argumentsValue[0]));
        case 'acp:get-history':
          return controller.history(String(argumentsValue[0]));
        default:
          throw new Error(`Unknown ACP channel: ${channel}`);
      }
    });
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
  const migration = migrateLegacyUserData({
    legacyUserDataDirectory: join(app.getPath('appData'), 'terminal-agent'),
    targetUserDataDirectory: app.getPath('userData'),
  });
  if (migration.status === 'migrated') {
    debug('legacy-user-data-migrated', migration.directories);
  } else {
    debug('legacy-user-data-skip', migration.reason);
  }
  const supervisor = createSupervisor();
  debug('supervisor-created');
  const attachmentController = createDesktopAttachmentController({
    selectPaths: async (kind) => {
      const result = await dialog.showOpenDialog({
        title: kind === 'image' ? '选择图片' : '选择文件',
        properties: ['openFile', 'multiSelections'],
        ...(kind === 'image'
          ? {
              filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
            }
          : {}),
      });
      return result.canceled ? [] : result.filePaths;
    },
  });
  const bridge = createDesktopCoreBridge(
    supervisor,
    (event) => broadcast('terminal:output', event),
    (event) => broadcast('agent:timeline', event),
    process.env,
    () => ({ home: app.getPath('home'), shells: new ShellLocator().list() }),
    (event) => broadcast('session:resources', event),
    (event) => broadcast('session:changed', event),
    attachmentController,
  );
  const mcpController = createMcpController({
    settingsDirectory: join(app.getPath('userData'), 'mcp'),
    request: (method, payload) => supervisor.request(method, payload),
  });
  const acpController = createAcpController({
    settingsDirectory: join(app.getPath('userData'), 'acp'),
    request: (method, payload) => supervisor.request(method, payload),
    onTimeline: (event) => broadcast('agent:timeline', event),
    onStatusChanged: (status) => broadcast('acp:status-changed', status),
  });
  registerIpc(bridge);
  registerMcpIpc(mcpController);
  registerAcpIpc(acpController);
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
        void mcpController
          .dispose()
          .catch((error: unknown) => debug('mcp-dispose-error', error))
          .finally(async () => {
            try {
              await acpController.dispose();
            } catch (error: unknown) {
              debug('acp-dispose-error', error);
            }
            app.quit();
          });
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
