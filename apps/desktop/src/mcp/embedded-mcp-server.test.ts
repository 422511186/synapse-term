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
      'local_list_files',
      'local_read_file',
      'local_search_files',
      'terminal_execute',
      'terminal_interrupt',
      'terminal_observe',
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

    await client.close();
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
    expect(text).toContain('无效的会话标识');
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
