import { describe, expect, it } from 'vitest';

import {
  MCP_TOOL_NAMES,
  runMcpTool,
  serializeMcpToolError,
  validateToolInput,
  type McpToolRuntime,
} from './mcp-tools.js';

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
  it('exposes exactly the eight protocol tools', () => {
    expect(MCP_TOOL_NAMES).toEqual([
      'synapse_execute',
      'synapse_start_interactive',
      'synapse_input',
      'synapse_finish_interactive',
      'synapse_observe',
      'synapse_wait',
      'synapse_interrupt',
      'synapse_status',
    ]);
  });

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

  it('validates interactive start, input mode combinations, and finish cursors', () => {
    const validStart = {
      sessionId: 'session-1',
      command: 'sudo su -',
      expectedContextId: 'context-1',
      inputGrantMode: 'bounded',
    };
    expect(validateToolInput('synapse_start_interactive', validStart)).toBeUndefined();
    expect(
      validateToolInput('synapse_start_interactive', {
        ...validStart,
        inputGrantMode: 'unlimited',
      }),
    ).toMatch(/^POLICY_DENIED:/);
    expect(
      validateToolInput('synapse_finish_interactive', {
        sessionId: 'session-1',
        transactionId: 'transaction-1',
      }),
    ).toMatch(/^OUTPUT_CURSOR_STALE:/);
    expect(
      validateToolInput('synapse_finish_interactive', {
        sessionId: 'session-1',
        transactionId: 'transaction-1',
        observedCursor: 'x'.repeat(2_049),
      }),
    ).toMatch(/^OUTPUT_CURSOR_STALE:/);

    const common = {
      sessionId: 'session-1',
      inputRequestId: 'request-1',
      text: 'password\n',
    };
    expect(
      validateToolInput('synapse_input', {
        ...common,
        transactionId: 'transaction-1',
        inputGrantId: 'grant-1',
      }),
    ).toBeUndefined();
    expect(
      validateToolInput('synapse_input', {
        ...common,
        transactionId: 'transaction-1',
        inputGrantId: 'grant-1',
        expectedContextId: 'context-1',
      }),
    ).toMatch(/^POLICY_DENIED:/);
    expect(
      validateToolInput('synapse_input', {
        ...common,
        transactionId: 'transaction-1',
      }),
    ).toMatch(/^POLICY_DENIED:/);
    expect(
      validateToolInput('synapse_input', {
        sessionId: 'session-1',
        expectedContextId: 'context-1',
        inputRequestId: 'request-1',
        keys: ['not-a-key'],
      }),
    ).toMatch(/^COMMAND_NOT_AUDITABLE:/);
    expect(
      validateToolInput('synapse_input', {
        sessionId: 'session-1',
        expectedContextId: 'context-1',
        inputRequestId: 'request-1',
      }),
    ).toMatch(/^COMMAND_NOT_AUDITABLE:/);
  });

  it('rejects controls, UTF-8 oversize text, excessive keys, and invalid request IDs before runtime calls', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const runtime = createRuntime(async (_name, input) => {
      calls.push(input);
      return { unexpected: true };
    });
    const base = {
      sessionId: 'session-1',
      expectedContextId: 'context-1',
      inputRequestId: 'request-1',
    };
    const invalidInputs: Array<Record<string, unknown>> = [
      { ...base, text: 'bad\rreturn' },
      { ...base, text: 'bad\u001bsequence' },
      { ...base, text: '😀'.repeat(2_049) },
      { ...base, keys: Array.from({ length: 129 }, () => 'up') },
      { ...base, inputRequestId: 'bad\u0000id', text: 'x' },
      { ...base, text: '', keys: [] },
    ];

    for (const input of invalidInputs) {
      const result = await runMcpTool(runtime, 'synapse_input', input, 'token-1');
      expect(result.isError).toBe(true);
      await expect(textOf(result)).resolves.toMatch(/^(?:POLICY_DENIED|COMMAND_NOT_AUDITABLE):/);
    }
    expect(calls).toEqual([]);
  });

  it('preserves the stable input and startup uncertainty error codes', () => {
    expect(
      serializeMcpToolError(new Error('INPUT_GRANT_EXHAUSTED: quota reached 请结束事务。')),
    ).toMatch(/^INPUT_GRANT_EXHAUSTED:/);
    expect(
      serializeMcpToolError(
        new Error('INTERACTIVE_START_WRITE_UNKNOWN: delivery is uncertain; do not retry.'),
      ),
    ).toMatch(/^INTERACTIVE_START_WRITE_UNKNOWN:/);
    expect(serializeMcpToolError(new Error('TRANSACTION_NOT_ACTIVE: old code'))).toMatch(
      /^SESSION_NOT_READY:/,
    );
  });
});
