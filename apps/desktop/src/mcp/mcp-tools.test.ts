/**
 * MCP 工具边界测试（specs/mcp-access）
 *
 * 覆盖稳定错误码格式化：会话未就绪 / 已失效 / 占用等状态必须返回
 * 可解析的错误码与恢复指引，而不是只回传内部 message 或抛异常。
 */
import { describe, expect, it } from 'vitest';

import { runMcpTool, type McpToolRuntime } from './mcp-tools.js';
import type { McpSettings } from './mcp-settings.js';

const settings: McpSettings = { enabled: true, approvalMode: 'managed', token: 'secret' };

function runtimeFor(request: McpToolRuntime['request']): McpToolRuntime {
  return { getSettings: () => settings, request };
}

describe('runMcpTool stable error codes', () => {
  it('maps session_not_ready to SESSION_NOT_READY with retry guidance', async () => {
    const result = await runMcpTool(
      runtimeFor(async () => ({
        ok: false,
        error: 'session_not_ready',
        message: 'Session shell is not ready',
        recoverable: true,
      })),
      'external.terminalExecute',
      { sessionId: 'session-1', command: 'ls' },
    );
    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain('SESSION_NOT_READY');
    expect(text).toContain('Session shell is not ready');
    expect(text).toContain('稍后重试');
  });

  it('maps invalid_session to SESSION_EXPIRED with re-share guidance', async () => {
    const result = await runMcpTool(
      runtimeFor(async () => ({
        ok: false,
        error: 'invalid_session',
        message: '无效的会话标识',
      })),
      'external.terminalExecute',
      { sessionId: 'session-1', command: 'ls' },
    );
    const text = JSON.stringify(result.content);
    expect(text).toContain('SESSION_EXPIRED');
    expect(text).toContain('重新复制并共享会话 ID');
  });

  it('maps thrown invalid_session errors to SESSION_EXPIRED without leaking the id', async () => {
    const result = await runMcpTool(
      runtimeFor(async () => {
        throw Object.assign(new Error('无效的会话标识'), { code: 'invalid_session' });
      }),
      'external.terminalExecute',
      { sessionId: 'secret-session-id', command: 'ls' },
    );
    const text = JSON.stringify(result.content);
    expect(text).toContain('SESSION_EXPIRED');
    expect(text).not.toContain('secret-session-id');
  });

  it('maps lease_unavailable to SESSION_BUSY', async () => {
    const result = await runMcpTool(
      runtimeFor(async () => ({
        ok: false,
        error: 'lease_unavailable',
        message: '会话当前被用户或内置 Agent 占用',
        recoverable: true,
      })),
      'external.terminalExecute',
      { sessionId: 'session-1', command: 'ls' },
    );
    const text = JSON.stringify(result.content);
    expect(text).toContain('SESSION_BUSY');
    expect(text).toContain('占用');
  });

  it('maps transaction_not_found to TRANSACTION_NOT_FOUND', async () => {
    const result = await runMcpTool(
      runtimeFor(async () => ({
        ok: false,
        error: 'transaction_not_found',
        message: 'transaction not found',
        recoverable: false,
      })),
      'external.terminalWait',
      { sessionId: 'session-1', transactionId: 'tx-1' },
    );
    expect(JSON.stringify(result.content)).toContain('TRANSACTION_NOT_FOUND');
  });

  it('keeps other stable business codes such as POLICY_DENIED', async () => {
    const result = await runMcpTool(
      runtimeFor(async () => ({
        ok: false,
        error: 'policy_denied',
        message: '当前外部审批配置不允许该命令',
        recoverable: false,
      })),
      'external.terminalExecute',
      { sessionId: 'session-1', command: 'rm -rf /' },
    );
    const text = JSON.stringify(result.content);
    expect(text).toContain('POLICY_DENIED');
    expect(text).toContain('当前外部审批配置不允许该命令');
  });
});
