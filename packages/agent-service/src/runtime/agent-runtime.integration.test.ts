import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';

import { createAgentTask } from '@synapse-term/domain';
import { FakeProvider, FakePty } from '@synapse-term/test-kit';

import { AgentRuntime } from './agent-runtime.js';
import { ApprovalManager } from '@synapse-term/platform-kernel';
import { CommandExecutor } from '@synapse-term/terminal-service';
import { ContextBuilder } from '../context/context-builder.js';
import type { ModelEvent, ModelRequest } from '@synapse-term/model-providers';
import { PolicyEngine } from '@synapse-term/platform-kernel';
import { SessionActor } from '@synapse-term/terminal-service';
import { TerminalToolGateway } from '@synapse-term/platform-kernel';

describe('AgentRuntime integration', () => {
  it('completes a read-only natural-language goal through the real ToolGateway', async () => {
    const pty = new FakePty(1);
    const actor = new SessionActor('session-1', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('posix', 'unix', 'linux');
    const lease = await actor.grantAgentLease('task-1', 0);
    if (!lease.ok) throw new Error('expected lease');
    const executor = new CommandExecutor(actor, {
      nonceFactory: () => 'runtime-nonce',
      observationWindowMs: 5_000,
    });
    const gateway = new TerminalToolGateway({
      sessionId: 'session-1',
      taskId: 'task-1',
      leaseEpoch: lease.value.lease.epoch,
      actor,
      executor,
      policy: new PolicyEngine({ parse: async () => ({ hasError: false, tree: 'program' }) }),
      approvals: new ApprovalManager(),
      permissionMode: 'auto',
    });
    const provider = new FakeProvider<ModelRequest, ModelEvent>();
    provider.enqueueTurn([
      { type: 'tool_call_started', id: 'call-1', name: 'terminal_execute' },
      {
        type: 'tool_call_completed',
        id: 'call-1',
        name: 'terminal_execute',
        argumentsJson: '{"command":"df -h"}',
      },
      { type: 'turn_completed', stopReason: 'tool_call' },
    ]);
    provider.enqueueTurn([
      { type: 'text_delta', delta: 'Disk usage is normal.' },
      { type: 'turn_completed', stopReason: 'stop' },
    ]);
    provider.enqueueTurn([
      { type: 'text_delta', delta: 'Disk usage is normal.' },
      { type: 'turn_completed', stopReason: 'stop' },
    ]);
    const runtime = new AgentRuntime({
      task: createAgentTask({
        id: 'task-1',
        sessionId: 'session-1',
        providerProfileId: 'provider-1',
        goal: 'check disk usage',
      }),
      model: 'model-1',
      adapter: provider,
      gateway,
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: 'check disk usage' },
    });

    const result = runtime.run();
    while (!pty.writes.some((write) => write.includes("'__TA_'") || write.includes("'START__'"))) {
      await yieldImmediate();
    }
    pty.emitData('__TA_START__disk output\n__TA_DONE_runtime-nonce;0__');

    await expect(result).resolves.toMatchObject({
      status: 'completed',
      answer: 'Disk usage is normal.',
    });
    expect(provider.requests).toHaveLength(3);
  }, 10_000);

  it('returns a failed terminal command to the model before it chooses a replacement', async () => {
    const pty = new FakePty(1);
    const actor = new SessionActor('session-1', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('posix', 'unix', 'linux');
    const lease = await actor.grantAgentLease('task-1', 0);
    if (!lease.ok) throw new Error('expected lease');
    let nonceIndex = 0;
    const executor = new CommandExecutor(actor, {
      nonceFactory: () => 'runtime-failure-' + ++nonceIndex,
      observationWindowMs: 5_000,
    });
    const gateway = new TerminalToolGateway({
      sessionId: 'session-1',
      taskId: 'task-1',
      leaseEpoch: lease.value.lease.epoch,
      actor,
      executor,
      policy: new PolicyEngine({ parse: async () => ({ hasError: false, tree: 'program' }) }),
      approvals: new ApprovalManager(),
      permissionMode: 'auto',
    });
    const provider = new FakeProvider<ModelRequest, ModelEvent>();
    provider.enqueueTurn([
      { type: 'tool_call_started', id: 'call-failed', name: 'terminal_execute' },
      {
        type: 'tool_call_completed',
        id: 'call-failed',
        name: 'terminal_execute',
        argumentsJson: '{"command":"cat /definitely/missing/path"}',
      },
      { type: 'turn_completed', stopReason: 'tool_call' },
    ]);
    provider.enqueueTurn([
      { type: 'tool_call_started', id: 'call-replacement', name: 'terminal_execute' },
      {
        type: 'tool_call_completed',
        id: 'call-replacement',
        name: 'terminal_execute',
        argumentsJson: '{"command":"printf fallback"}',
      },
      { type: 'turn_completed', stopReason: 'tool_call' },
    ]);
    provider.enqueueTurn([
      { type: 'text_delta', delta: '原命令失败，已改用替代命令。' },
      { type: 'turn_completed', stopReason: 'stop' },
    ]);
    provider.enqueueTurn([
      { type: 'text_delta', delta: '原命令失败，已改用替代命令。' },
      { type: 'turn_completed', stopReason: 'stop' },
    ]);
    const runtime = new AgentRuntime({
      task: createAgentTask({
        id: 'task-1',
        sessionId: 'session-1',
        providerProfileId: 'provider-1',
        goal: 'inspect memory',
      }),
      model: 'model-1',
      adapter: provider,
      gateway,
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: 'inspect memory' },
    });

    const result = runtime.run();
    while (!pty.writes.some((write) => write.includes('cat /definitely/missing/path'))) {
      await yieldImmediate();
    }
    pty.emitData(
      '__TA_START__cat: /definitely/missing/path: No such file or directory\n__TA_DONE_runtime-failure-1;1__',
    );
    while (!pty.writes.some((write) => write.includes('printf fallback'))) {
      await yieldImmediate();
    }
    pty.emitData('__TA_START__fallback\n__TA_DONE_runtime-failure-2;0__');

    await expect(result).resolves.toMatchObject({
      status: 'completed',
      answer: '原命令失败，已改用替代命令。',
    });
    expect(provider.requests[1]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_result',
          toolCallId: 'call-failed',
          isError: true,
          content: expect.stringContaining('No such file or directory'),
        }),
      ]),
    );
  }, 10_000);
});
