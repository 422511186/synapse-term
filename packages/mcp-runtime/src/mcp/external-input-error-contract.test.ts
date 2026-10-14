import { describe, expect, it } from 'vitest';

import { FakeTerminalBackend, createFakeTerminalBackend } from '@synapse-term/test-kit';
import type { ExternalCaller } from '@synapse-term/domain';
import { CommandExecutor, SessionActor } from '@synapse-term/terminal-service';

import { ExternalToolPipeline, type McpToolContext } from './external-tool-pipeline.js';

/**
 * 自由输入（`synapse_input` 自由模式）前提失败对外的稳定错误码基线。
 *
 * 结构收敛（tasks 第 1 组）不得改变这里的任何断言。
 */

const caller: ExternalCaller = { kind: 'mcp', id: 'contract-client' };
const fullMode: McpToolContext = { caller, mode: 'full' };

class WriteRefusingBackend extends FakeTerminalBackend {
  writeAttempts = 0;

  override write(): void {
    this.writeAttempts += 1;
    throw new Error('PTY write refused');
  }
}

async function createHarness(backend: FakeTerminalBackend = createFakeTerminalBackend()) {
  const actor = new SessionActor('contract-session', backend, {
    title: 'contract',
    terminalType: 'bash',
  });
  await actor.markPtyRunning();
  await actor.verifyEnvironment('posix', 'unix');
  const executor = new CommandExecutor(actor, { observationWindowMs: 5 });
  return { actor, backend, pipeline: new ExternalToolPipeline({ actor, executor }) };
}

describe('自由输入前提失败的外部错误码', () => {
  it('写入前 executionContextId 失配时以 EXECUTION_CONTEXT_STALE 拒绝且不写入 PTY', async () => {
    const { actor, backend, pipeline } = await createHarness();

    const result = await pipeline.input(
      {
        expectedContextId: 'stale-context',
        inputRequestId: 'contract-free-1',
        text: 'x',
        keys: [],
      },
      fullMode,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a denial');
    expect(result.error).toBe('EXECUTION_CONTEXT_STALE');
    expect(backend.writes).toEqual([]);
    actor.dispose();
  });

  it('写入尝试交付未确认时以 INPUT_WRITE_UNKNOWN 收敛且不恢复旧 environment', async () => {
    const backend = new WriteRefusingBackend();
    const { actor, pipeline } = await createHarness(backend);
    const contextId = actor.snapshot.executionContextId;

    const result = await pipeline.input(
      { expectedContextId: contextId, inputRequestId: 'contract-free-2', text: 'x', keys: [] },
      fullMode,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a denial');
    expect(result.error).toBe('INPUT_WRITE_UNKNOWN');
    expect(backend.writeAttempts).toBe(1);
    expect(backend.writes).toEqual([]);
    expect(actor.snapshot.environment.verificationStatus).toBe('unverified');
    expect(actor.snapshot.executionContextId).not.toBe(contextId);
    actor.dispose();
  });
});
