/**
 * MCP 控制器（specs/mcp-access）
 *
 * 桌面主进程侧的单一入口：持有设置缓存与内嵌端点，串行化所有配置变更，
 * 渲染进程只能通过 IPC 调用这里暴露的用例（开关、审批模式、token 管理）。
 */
import { EmbeddedMcpServer, type EmbeddedMcpServerOptions } from './embedded-mcp-server.js';
import {
  createMcpSettingsStore,
  generateMcpToken,
  type McpApprovalMode,
  type McpSettings,
  type McpSettingsStore,
} from './mcp-settings.js';

export interface McpControllerStatus {
  enabled: boolean;
  running: boolean;
  approvalMode: McpApprovalMode;
  hasToken: boolean;
  token?: string;
  port?: number;
  connectionString?: string;
}

export interface McpController {
  status(): Promise<McpControllerStatus>;
  setEnabled(enabled: boolean): Promise<McpControllerStatus>;
  setApprovalMode(mode: McpApprovalMode): Promise<McpControllerStatus>;
  regenerateToken(): Promise<McpControllerStatus>;
  revokeToken(): Promise<McpControllerStatus>;
  dispose(): Promise<void>;
}

export interface McpControllerOptions {
  settingsDirectory: string;
  request: EmbeddedMcpServerOptions['request'];
  host?: string;
}

export function createMcpController(options: McpControllerOptions): McpController {
  const store = createMcpSettingsStore(options.settingsDirectory);
  return createMcpControllerWithStore(store, options);
}

/** 与真实实现同构的构造入口，供测试注入内存/临时目录设置存储 */
export function createMcpControllerWithStore(
  store: McpSettingsStore,
  options: McpControllerOptions,
): McpController {
  let settings: McpSettings = { enabled: false, approvalMode: 'read_only' };
  let server: EmbeddedMcpServer | undefined;
  let mutation: Promise<void> = Promise.resolve();

  const serverOptions: EmbeddedMcpServerOptions = {
    getSettings: () => settings,
    request: options.request,
    ...(options.host === undefined ? {} : { host: options.host }),
  };

  async function refreshServer(): Promise<void> {
    const shouldRun = settings.enabled && settings.token !== undefined;
    if (shouldRun && (server === undefined || !server.status.running)) {
      if (server === undefined) server = new EmbeddedMcpServer(serverOptions);
      await server.start(settings.port);
      // 首选端口被占用而回退时，持久化实际端口，保证下一次启动仍稳定
      const actualPort = server.status.port;
      if (actualPort !== undefined && settings.port !== actualPort) {
        settings = { ...settings, port: actualPort };
        await store.save(settings);
      }
      return;
    }
    if (!shouldRun && server !== undefined && server.status.running) {
      await server.stop();
    }
  }

  function toStatus(): McpControllerStatus {
    const endpoint = server?.status;
    return {
      enabled: settings.enabled,
      running: endpoint?.running ?? false,
      approvalMode: settings.approvalMode,
      hasToken: settings.token !== undefined,
      ...(settings.token === undefined ? {} : { token: settings.token }),
      ...(endpoint?.port === undefined ? {} : { port: endpoint.port }),
      ...(endpoint?.connectionString === undefined
        ? {}
        : { connectionString: endpoint.connectionString }),
    };
  }

  /** 串行化配置变更，避免开关与 token 操作并发产生竞态 */
  function mutate(next: () => Promise<void>): Promise<McpControllerStatus> {
    const run = mutation.then(async () => {
      await boot;
      await next();
      await refreshServer();
    });
    mutation = run.catch(() => undefined);
    return run.then(() => toStatus());
  }

  // 启动时先加载持久化设置；若上次退出时仍处于启用状态，自动恢复端点监听。
  const boot = store.load().then(async (loaded) => {
    settings = loaded;
    await refreshServer();
  });

  return {
    status: async () => {
      await boot;
      await mutation;
      return toStatus();
    },
    setEnabled: (enabled) =>
      mutate(async () => {
        // 启用时若还没有 token，自动生成一个，避免“开了但连不上”的空窗。
        settings = {
          ...settings,
          enabled,
          ...(enabled && settings.token === undefined ? { token: generateMcpToken() } : {}),
          // 首次启用分配稳定端口，之后沿用持久化端口
          ...(enabled && settings.port === undefined ? { port: DEFAULT_MCP_PORT } : {}),
        };
        await store.save(settings);
      }),
    setApprovalMode: (mode) =>
      mutate(async () => {
        settings = { ...settings, approvalMode: mode };
        await store.save(settings);
      }),
    regenerateToken: () =>
      mutate(async () => {
        settings = { ...settings, token: generateMcpToken() };
        await store.save(settings);
      }),
    revokeToken: () =>
      mutate(async () => {
        const { token: _removed, ...rest } = settings;
        void _removed;
        settings = { ...rest };
        await store.save(settings);
      }),
    dispose: async () => {
      await boot;
      await mutation;
      await server?.stop();
      server = undefined;
    },
  };
}

const DEFAULT_MCP_PORT = 18_789;
