/**
 * 桌面内嵌 MCP 端点协议级测试（specs/mcp-access）
 *
 * 使用官方 MCP 客户端 SDK 走真实 Streamable HTTP 传输，覆盖：
 * - Bearer token 认证（缺失 / 错误 / 吊销后全部拒绝）；
 * - 工具列表与外部形态 → 内部 Core API 翻译（带 caller + approvalMode）；
 * - 无效 sessionId 返回稳定错误且不泄露会话存在性；
 * - 关闭端点后无残留监听（外部调用全部失败）。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';

import { EmbeddedMcpServer } from './embedded-mcp-server.js';
import type { McpSettings } from './mcp-settings.js';

function createRuntime(
  settings: McpSettings,
  request: (method: string, payload: unknown) => Promise<unknown>,
) {
  return { getSettings: () => settings, request };
}

function createCoreRequest() {
  return vi.fn(async (method: string, payload: unknown): Promise<unknown> => {
    if (method === 'external.terminalExecute') {
      const input = payload as { sessionId: string };
      if (input.sessionId === 'invalid-session') {
        throw Object.assign(new Error('无效的会话标识'), { code: 'invalid_session' });
      }
      return { ok: true, result: { status: 'running', transactionId: 'tx-1' } };
    }
    if (method === 'external.terminalStatus') {
      const input = payload as { sessionId: string };
      if (input.sessionId === 'invalid-session') {
        return {
          ok: true,
          result: {
            sessionId: input.sessionId,
            status: 'expired',
            shared: false,
            hint: '会话已失效：请在桌面端重新复制并共享会话 ID 后再调用',
          },
        };
      }
      return {
        ok: true,
        result: {
          sessionId: input.sessionId,
          status: 'ready',
          shared: true,
          pty: 'running',
          shell: 'ready',
          hint: '会话可用',
        },
      };
    }
    if (method === 'external.terminalObserve') {
      return {
        ok: true,
        result: { status: 'observed', sessionId: (payload as { sessionId: string }).sessionId },
      };
    }
    throw new Error(`Unexpected core method: ${method}`);
  });
}

async function startServer(
  settings: McpSettings,
  request: (method: string, payload: unknown) => Promise<unknown>,
) {
  const server = new EmbeddedMcpServer(createRuntime(settings, request));
  await server.start();
  return server;
}

function clientTransport(port: number, token: string | undefined): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
    token === undefined
      ? undefined
      : { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
  );
}

async function connectClient(port: number, token: string | undefined): Promise<Client> {
  const client = new Client({ name: 'test-mcp-client', version: '1.0.0' }, { capabilities: {} });
  // SDK 类型在 exactOptionalPropertyTypes 下与 Transport 接口不完全兼容，此处显式收窄。
  await client.connect(clientTransport(port, token) as unknown as Transport);
  return client;
}

describe('EmbeddedMcpServer', () => {
  it('rejects startup when MCP is disabled or has no token', async () => {
    const disabled = new EmbeddedMcpServer(
      createRuntime({ enabled: false, approvalMode: 'read_only' }, vi.fn()),
    );
    await expect(disabled.start()).rejects.toThrow('未启用');

    const noToken = new EmbeddedMcpServer(
      createRuntime({ enabled: true, approvalMode: 'read_only' }, vi.fn()),
    );
    await expect(noToken.start()).rejects.toThrow('缺少访问 token');
  });

  it('requires a valid Bearer token for every request', async () => {
    const settings: McpSettings = { enabled: true, approvalMode: 'managed', token: 'secret-token' };
    const server = await startServer(settings, createCoreRequest());
    const port = server.status.port!;

    // 未带 token / 错误 token：连接被拒
    await expect(connectClient(port, undefined)).rejects.toThrow();
    await expect(connectClient(port, 'wrong-token')).rejects.toThrow();

    // 直接 HTTP 请求同样被 401 拒绝（不含业务错误细节）
    const unauthorized = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(unauthorized.status).toBe(401);

    await server.stop();
  });

  it('exposes the external tool set and translates calls into Core API use cases', async () => {
    const settings: McpSettings = { enabled: true, approvalMode: 'managed', token: 'secret-token' };
    const request = createCoreRequest();
    const server = await startServer(settings, request);
    const client = await connectClient(server.status.port!, 'secret-token');

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'terminal_execute',
      'terminal_interrupt',
      'terminal_observe',
      'terminal_status',
      'terminal_wait',
    ]);

    const result = await client.callTool({
      name: 'terminal_execute',
      arguments: { sessionId: 'session-1', command: 'printf ok', observationWindowMs: 100 },
    });
    expect(result.isError).not.toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain('tx-1');

    // 端点层翻译：附加 mcp 调用者身份与设置中的审批模式
    expect(request).toHaveBeenCalledWith(
      'external.terminalExecute',
      expect.objectContaining({
        sessionId: 'session-1',
        command: 'printf ok',
        approvalMode: 'managed',
        caller: { kind: 'mcp', id: 'mcp-client', displayName: 'MCP 外部客户端' },
      }),
    );

    const status = await client.callTool({
      name: 'terminal_status',
      arguments: { sessionId: 'session-1' },
    });
    expect(status.isError).not.toBe(true);
    expect(JSON.stringify(status.content)).toContain('\\"status\\": \\"ready\\"');
    expect(request).toHaveBeenCalledWith(
      'external.terminalStatus',
      expect.objectContaining({
        sessionId: 'session-1',
        approvalMode: 'managed',
        caller: { kind: 'mcp', id: 'mcp-client', displayName: 'MCP 外部客户端' },
      }),
    );

    await client.close();
    await server.stop();
  });

  it('allows a client to re-initialize a new session after session loss', async () => {
    const settings: McpSettings = {
      enabled: true,
      approvalMode: 'read_only',
      token: 'secret-token',
    };
    const server = await startServer(settings, createCoreRequest());
    const port = server.status.port!;

    const first = await connectClient(port, 'secret-token');
    await expect(first.listTools()).resolves.toBeDefined();
    await first.close();

    // 模拟断线后客户端丢失 sessionId：以全新 transport 重新初始化，
    // 不应得到 400 "Server already initialized"
    const second = await connectClient(port, 'secret-token');
    await expect(second.listTools()).resolves.toBeDefined();
    await second.close();
    await server.stop();
  });

  it('serves two concurrent clients with independent sessions', async () => {
    const settings: McpSettings = {
      enabled: true,
      approvalMode: 'read_only',
      token: 'secret-token',
    };
    const server = await startServer(settings, createCoreRequest());
    const port = server.status.port!;

    const first = await connectClient(port, 'secret-token');
    const second = await connectClient(port, 'secret-token');
    await expect(first.listTools()).resolves.toBeDefined();
    await expect(second.listTools()).resolves.toBeDefined();
    await first.close();
    await second.close();
    await server.stop();
  });

  it('restarts cleanly after stop with an active client connected', async () => {
    const mutable: { settings: McpSettings } = {
      settings: { enabled: true, approvalMode: 'read_only', token: 'secret-token' },
    };
    const server = new EmbeddedMcpServer({
      getSettings: () => mutable.settings,
      request: createCoreRequest(),
    });
    await server.start();

    const first = await connectClient(server.status.port!, 'secret-token');
    await expect(first.listTools()).resolves.toBeDefined();

    mutable.settings = { ...mutable.settings, enabled: false };
    await server.stop();
    expect(server.status.running).toBe(false);

    mutable.settings = { ...mutable.settings, enabled: true };
    await server.start();
    expect(server.status.running).toBe(true);

    const second = await connectClient(server.status.port!, 'secret-token');
    await expect(second.listTools()).resolves.toBeDefined();
    await second.close();
    await server.stop();
  });

  it('listens on the requested fixed port and keeps it across restarts', async () => {
    const port = await getFreePort();
    const server = new EmbeddedMcpServer({
      getSettings: () => ({ enabled: true, approvalMode: 'read_only', token: 'secret-token' }),
      request: createCoreRequest(),
    });

    await server.start(port);
    expect(server.status.port).toBe(port);

    await server.stop();
    await server.start(port);
    expect(server.status.port).toBe(port);
    await server.stop();
  });

  it('falls back to an ephemeral port when the requested port is occupied', async () => {
    const blocker = await listenOnFreePort();
    try {
      const server = new EmbeddedMcpServer({
        getSettings: () => ({ enabled: true, approvalMode: 'read_only', token: 'secret-token' }),
        request: createCoreRequest(),
      });

      await server.start(blocker.port);
      expect(server.status.running).toBe(true);
      expect(server.status.port).not.toBe(blocker.port);
      await server.stop();
    } finally {
      await closeServer(blocker.server);
    }
  });

  it('rejects requests with an unknown session id with 404 so the client can re-initialize', async () => {
    const settings: McpSettings = {
      enabled: true,
      approvalMode: 'read_only',
      token: 'secret-token',
    };
    const server = await startServer(settings, createCoreRequest());
    const port = server.status.port!;

    const stale = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret-token',
        'mcp-session-id': 'stale-session',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(stale.status).toBe(404);
    await server.stop();
  });

  it('maps invalid session ids to a stable error without leaking session details', async () => {
    const settings: McpSettings = {
      enabled: true,
      approvalMode: 'read_only',
      token: 'secret-token',
    };
    const request = createCoreRequest();
    const server = await startServer(settings, request);
    const client = await connectClient(server.status.port!, 'secret-token');

    const result = await client.callTool({
      name: 'terminal_execute',
      arguments: { sessionId: 'invalid-session', command: 'ls' },
    });
    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain('SESSION_EXPIRED');
    expect(text).toContain('重新复制并共享会话 ID');
    expect(text).not.toContain('invalid-session');

    await client.close();
    await server.stop();
  });

  it('rejects requests after the token is revoked and leaves no listener after stop', async () => {
    const mutable: { settings: McpSettings } = {
      settings: { enabled: true, approvalMode: 'read_only', token: 'secret-token' },
    };
    const server = new EmbeddedMcpServer({
      getSettings: () => mutable.settings,
      request: createCoreRequest(),
    });
    // 运行时通过闭包读取可变设置，模拟控制器吊销后内存缓存立即更新
    await server.start();
    const port = server.status.port!;

    const client = await connectClient(port, 'secret-token');
    await client.close();

    // 吊销：token 置空后新请求（含重连）全部 401
    mutable.settings = { enabled: true, approvalMode: 'read_only' };
    const revoked = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret-token',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(revoked.status).toBe(401);

    await server.stop();
    await expect(
      fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer secret-token',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    ).rejects.toThrow();
  });

  it('rejects non-MCP paths with 404', async () => {
    const settings: McpSettings = {
      enabled: true,
      approvalMode: 'read_only',
      token: 'secret-token',
    };
    const server = await startServer(settings, createCoreRequest());
    const response = await fetch(`http://127.0.0.1:${server.status.port!}/other`, {
      headers: { authorization: 'Bearer secret-token' },
    });
    expect(response.status).toBe(404);
    await server.stop();
  });
});

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createHttpServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

function listenOnFreePort(): Promise<{ server: HttpServer; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createHttpServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, port });
    });
  });
}

function closeServer(server: HttpServer): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
