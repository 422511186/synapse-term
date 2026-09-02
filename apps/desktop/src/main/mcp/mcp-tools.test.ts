import { describe, expect, it } from 'vitest';

import { runMcpTool, serializeMcpToolError, type McpToolRuntime } from './mcp-tools.js';

function createRuntime(
  callTool: McpToolRuntime['callTool'] = async () => ({ ok: true }),
): McpToolRuntime {
  return {
    getSettings: () => ({ enabled: true, approvalMode: 'full', port: 4_739, token: 'token-1' }),
    callTool,
  };
}

async function textOf(result: Awaited<ReturnType<typeof runMcpTool>>): Promise<string> {
  const content = result.content[0];
  if (content?.type !== 'text') throw new Error('expected text tool result');
  return content.text;
}

describe('MCP tool contract', () => {
  it('requires an observation context before execute and does not call the runtime', async () => {
    let calls = 0;
    const result = await runMcpTool(
      createRuntime(async () => {
        calls += 1;
        return { unexpected: true };
      }),
      'synapse_execute',
      { sessionId: 'session-1', command: 'ls' },
      'token-1',
    );

    expect(result.isError).toBe(true);
    expect(await textOf(result)).toMatch(
      /^EXECUTION_CONTEXT_REQUIRED:.*synapse_observe.*executionContextId/s,
    );
    expect(calls).toBe(0);
  });

  it('validates cursor pagination and the bounded wait timeout', async () => {
    await expect(
      textOf(
        await runMcpTool(
          createRuntime(),
          'synapse_observe',
          { sessionId: 'session-1', tail: true, afterCursor: 'cursor-1' },
          'token-1',
        ),
      ),
    ).resolves.toMatch(/^POLICY_DENIED:.*互斥/s);

    await expect(
      textOf(
        await runMcpTool(
          createRuntime(),
          'synapse_observe',
          { sessionId: 'session-1', afterCursor: 4 },
          'token-1',
        ),
      ),
    ).resolves.toMatch(/^POLICY_DENIED:.*afterCursor/s);

    await expect(
      textOf(
        await runMcpTool(
          createRuntime(),
          'synapse_wait',
          { sessionId: 'session-1', transactionId: 'tx-1', timeoutMs: 60_001 },
          'token-1',
        ),
      ),
    ).resolves.toMatch(/^POLICY_DENIED:.*60000/s);

    await expect(
      textOf(
        await runMcpTool(
          createRuntime(),
          'synapse_wait',
          { sessionId: 'session-1', transactionId: 'tx-1', timeoutMs: 0 },
          'token-1',
        ),
      ),
    ).resolves.toMatch(/^\{/);
  });

  it('validates every externally supplied identifier and bounded numeric field', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const runtime = createRuntime(async (_name, input) => {
      calls.push(input);
      return { unexpected: true };
    });
    const invalidInputs: Array<{ name: string; input: Record<string, unknown>; code: string }> = [
      { name: 'synapse_status', input: { sessionId: '' }, code: 'POLICY_DENIED' },
      {
        name: 'synapse_execute',
        input: { sessionId: 'session-1', command: 7, expectedContextId: 'context-1' },
        code: 'COMMAND_NOT_AUDITABLE',
      },
      {
        name: 'synapse_execute',
        input: { sessionId: 'session-1', command: 'ls', expectedContextId: 'x'.repeat(257) },
        code: 'EXECUTION_CONTEXT_REQUIRED',
      },
      {
        name: 'synapse_execute',
        input: {
          sessionId: 'session-1',
          command: 'ls',
          expectedContextId: 'context-1',
          observationWindowMs: 0,
        },
        code: 'POLICY_DENIED',
      },
      {
        name: 'synapse_observe',
        input: { sessionId: 'session-1', afterCursor: '' },
        code: 'POLICY_DENIED',
      },
      {
        name: 'synapse_observe',
        input: { sessionId: 'session-1', tail: 'true' },
        code: 'POLICY_DENIED',
      },
      {
        name: 'synapse_observe',
        input: { sessionId: 'session-1', maxBytes: 65_537 },
        code: 'POLICY_DENIED',
      },
      {
        name: 'synapse_wait',
        input: { sessionId: 'session-1', transactionId: '', timeoutMs: 30_000 },
        code: 'POLICY_DENIED',
      },
      {
        name: 'synapse_wait',
        input: { sessionId: 'session-1', transactionId: 'tx-1', timeoutMs: 60_001 },
        code: 'POLICY_DENIED',
      },
      {
        name: 'synapse_interrupt',
        input: { sessionId: 'session-1', transactionId: 11 },
        code: 'POLICY_DENIED',
      },
    ];

    for (const invalid of invalidInputs) {
      const result = await runMcpTool(runtime, invalid.name, invalid.input, 'token-1');
      expect(await textOf(result)).toMatch(new RegExp(`^${invalid.code}:`));
    }
    expect(calls).toEqual([]);
  });

  it('normalizes unexpected runtime failures without exposing PTY data', async () => {
    const result = await runMcpTool(
      createRuntime(async () => {
        throw new Error('raw PTY output: secret-token and probe bytes');
      }),
      'synapse_status',
      { sessionId: 'session-1' },
      'token-1',
    );

    const text = await textOf(result);
    expect(result.isError).toBe(true);
    expect(text).toMatch(/^SESSION_NOT_READY:/);
    expect(text).not.toContain('raw PTY output');
    expect(text).not.toContain('secret-token');
    expect(text).not.toContain('probe bytes');
  });

  it('keeps unknown serialized error codes and raw runtime details out of tool errors', async () => {
    const result = await runMcpTool(
      createRuntime(async () => {
        throw new Error('NOT_A_STABLE_CODE: raw PTY output secret and probe nonce');
      }),
      'synapse_observe',
      { sessionId: 'session-1' },
      'token-1',
    );

    const text = await textOf(result);
    expect(text).toMatch(/^SESSION_NOT_READY:/);
    expect(text).not.toContain('NOT_A_STABLE_CODE');
    expect(text).not.toContain('raw PTY output');
    expect(text).not.toContain('probe nonce');
  });

  it('preserves the authorization revocation code during serialization', () => {
    expect(
      serializeMcpToolError(new Error('AUTHORIZATION_REVOKED: token 已被吊销。请重建 MCP 连接。')),
    ).toMatch(/^AUTHORIZATION_REVOKED:/);
  });

  it('rejects unknown tool names with a stable error', async () => {
    const result = await runMcpTool(
      createRuntime(),
      'terminal_execute',
      { sessionId: 'session-1', command: 'ls' },
      'token-1',
    );

    expect(await textOf(result)).toMatch(/^POLICY_DENIED:/);
  });
});
