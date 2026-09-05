import { describe, expect, it, vi } from 'vitest';

import type { ExternalCaller } from '@synapse-term/domain';
import { createFakeTerminalBackend } from '@synapse-term/test-kit';
import {
  CommandExecutor,
  ExternalLeaseRegistry,
  InteractiveCommandExecutor,
  SessionActor,
} from '@synapse-term/terminal-service';

import { ExternalToolPipeline, type McpToolContext } from './external-tool-pipeline.js';

const caller: ExternalCaller = { kind: 'mcp', id: 'interactive-client' };
const fullContext: McpToolContext = { caller, mode: 'full' };

function completionNonce(write: string): string {
  const match = /'([A-Za-z0-9-]+)'/.exec(write);
  if (match === null) throw new Error(`missing nonce in ${write}`);
  return match[1]!;
}

async function flushActor(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function createHarness() {
  const backend = createFakeTerminalBackend();
  const actor = new SessionActor('pipeline-interactive', backend, {
    title: 'test',
    terminalType: 'bash',
  });
  await actor.markPtyRunning();
  await actor.verifyEnvironment('posix', 'unix');
  const executor = new CommandExecutor(actor, { completionDrainMs: 0 });
  const pipeline = new ExternalToolPipeline({ actor, executor });
  return { backend, actor, executor, pipeline };
}

async function createPipelineWithInteractiveOptions(
  options: ConstructorParameters<typeof InteractiveCommandExecutor>[1],
) {
  const backend = createFakeTerminalBackend();
  const actor = new SessionActor('pipeline-interactive-options', backend, {
    title: 'test',
    terminalType: 'bash',
  });
  await actor.markPtyRunning();
  await actor.verifyEnvironment('posix', 'unix');
  const executor = new CommandExecutor(actor, { completionDrainMs: 0 });
  const interactiveExecutor = new InteractiveCommandExecutor(actor, options);
  const pipeline = new ExternalToolPipeline({ actor, executor, interactiveExecutor });
  return { backend, actor, executor, interactiveExecutor, pipeline };
}

function input(transactionId: string, inputGrantId: string, inputRequestId: string, text: string) {
  return { transactionId, inputGrantId, inputRequestId, text };
}

describe('ExternalToolPipeline interactive input', () => {
  it('runs start, transactional input, observe, and finish without sending a startup Probe', async () => {
    const { backend, actor, pipeline } = await createHarness();
    const start = await pipeline.startInteractive(
      {
        command: 'sudo su -',
        expectedContextId: actor.snapshot.executionContextId,
        inputGrantMode: 'bounded',
      },
      fullContext,
    );
    expect(start).toMatchObject({
      ok: true,
      result: {
        status: 'running',
        transaction: { kind: 'interactive', command: 'sudo su -' },
        inputGrantMode: 'bounded',
      },
    });
    expect(backend.writes).toEqual(['sudo su -\r']);

    if (!start.ok) throw new Error('expected interactive start');
    const transaction = start.result.transaction as { id: string };
    const grant = start.result.inputGrantId as string;
    const inputResult = await pipeline.input(
      input(transaction.id, grant, 'password-1', 'secret-password\n'),
      fullContext,
    );
    expect(inputResult).toMatchObject({
      ok: true,
      result: { sent: { textLength: 16, payloadBytes: 16 } },
    });
    expect(backend.writes).toEqual(['sudo su -\r', 'secret-password\r']);
    expect(JSON.stringify(inputResult)).not.toContain('secret-password');

    backend.emitData('root-shell$ ');
    await flushActor();
    const observed = await pipeline.observe({}, fullContext);
    expect(observed).toMatchObject({ ok: true, result: { output: 'root-shell$ ' } });
    if (!observed.ok) throw new Error('expected observe result');
    const observedCursor = observed.result.nextCursor as string;

    const finishing = pipeline.finishInteractive(
      { transactionId: transaction.id, observedCursor },
      fullContext,
    );
    await vi.waitFor(() => expect(backend.writes).toHaveLength(3));
    const nonce = completionNonce(backend.writes[2]!);
    backend.emitData(`\x1b]777;TA;${nonce};0\x07`);
    await expect(finishing).resolves.toMatchObject({
      ok: true,
      result: { status: 'completed', transaction: { kind: 'interactive', exitCode: 0 } },
    });
    await expect(
      pipeline.interrupt({ transactionId: transaction.id }, fullContext),
    ).resolves.toMatchObject({ ok: false, error: 'TRANSACTION_NOT_FOUND' });
    expect(backend.writes[2]).not.toContain('sudo su -');
    expect(actor.snapshot.environment.verificationStatus).toBe('unverified');
    await pipeline.clear();
    actor.dispose();
  });

  it('replays the same request id without writing twice and rejects payload conflicts', async () => {
    const { backend, actor, pipeline } = await createHarness();
    const start = await pipeline.startInteractive(
      {
        command: 'vim notes.txt',
        expectedContextId: actor.snapshot.executionContextId,
        inputGrantMode: 'one_shot',
      },
      fullContext,
    );
    if (!start.ok) throw new Error('expected start');
    const ids = {
      transactionId: (start.result.transaction as { id: string }).id,
      inputGrantId: start.result.inputGrantId as string,
    };
    const first = await pipeline.input(
      input(ids.transactionId, ids.inputGrantId, 'same-request', ':wq\n'),
      fullContext,
    );
    const second = await pipeline.input(
      input(ids.transactionId, ids.inputGrantId, 'same-request', ':wq\n'),
      fullContext,
    );
    expect(second).toEqual(first);
    expect(backend.writes).toEqual(['vim notes.txt\r', ':wq\r']);

    await expect(
      pipeline.input(
        input(ids.transactionId, ids.inputGrantId, 'same-request', ':q!\n'),
        fullContext,
      ),
    ).resolves.toMatchObject({ ok: false, error: 'POLICY_DENIED' });
    await pipeline.clear();
    actor.dispose();
  });

  it('approves interactive start with the selected grant mode but does not expose future text', async () => {
    const { backend, actor } = await createHarness();
    let approvalRequest: unknown;
    const approved = new ExternalToolPipeline({
      actor,
      executor: new CommandExecutor(actor, { completionDrainMs: 0 }),
      requestApproval: async (request) => {
        approvalRequest = request;
        return 'allow_once';
      },
    });
    const result = await approved.startInteractive(
      {
        command: 'sudo su -',
        expectedContextId: actor.snapshot.executionContextId,
        inputGrantMode: 'one_shot',
      },
      { caller, mode: 'managed' },
    );
    expect(result).toMatchObject({ ok: true, result: { inputGrantMode: 'one_shot' } });
    expect(approvalRequest).toMatchObject({
      kind: 'interactive',
      inputGrantMode: 'one_shot',
      inputLimits: { maxCalls: 1 },
    });
    expect(JSON.stringify(approvalRequest)).not.toContain('password');
    expect(backend.writes).toEqual(['sudo su -\r']);
    await approved.clear();
    actor.dispose();
  });

  it('uses a fresh context for free input and blocks it while a transaction is active', async () => {
    const { backend, actor, pipeline } = await createHarness();
    const context = actor.snapshot.executionContextId;
    const free = await pipeline.input(
      { expectedContextId: context, inputRequestId: 'menu-1', keys: ['down', 'enter'] },
      fullContext,
    );
    expect(free).toMatchObject({
      ok: true,
      result: { sent: { keys: ['down', 'enter'] }, executionContextId: expect.any(String) },
    });
    expect(backend.writes).toEqual(['\x1b[B\r']);
    const nextContext = actor.snapshot.executionContextId;
    expect(nextContext).not.toBe(context);
    await actor.verifyEnvironment('posix', 'unix');

    const start = await pipeline.startInteractive(
      {
        command: 'bash -i',
        expectedContextId: nextContext,
        inputGrantMode: 'bounded',
      },
      fullContext,
    );
    if (!start.ok) throw new Error('expected start');
    const blocked = await pipeline.input(
      {
        expectedContextId: actor.snapshot.executionContextId,
        inputRequestId: 'menu-2',
        keys: ['enter'],
      },
      fullContext,
    );
    expect(blocked).toMatchObject({ ok: false, error: 'SESSION_BUSY' });
    await pipeline.clear();
    actor.dispose();
  });

  it('rejects structured transaction IDs in the interactive finish tool', async () => {
    const { backend, actor, pipeline } = await createHarness();
    const structured = await pipeline.execute(
      { command: 'sleep 100', expectedContextId: actor.snapshot.executionContextId },
      fullContext,
    );
    if (!structured.ok) throw new Error('expected structured transaction');
    const transactionId = (structured.result.transaction as { id: string }).id;

    await expect(
      pipeline.finishInteractive(
        { transactionId, observedCursor: structured.result.nextCursor as string },
        fullContext,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: 'POLICY_DENIED',
      message: expect.stringContaining('synapse_wait'),
    });
    const writesBeforeFinish = backend.writes.length;
    backend.emitData(`\x1b]777;TA;n1;0\x07`);
    expect(backend.writes).toHaveLength(writesBeforeFinish);
    await pipeline.clear();
    actor.dispose();
  });

  it('does not write a finish Probe when the observed cursor is stale', async () => {
    const { backend, actor, pipeline } = await createHarness();
    const start = await pipeline.startInteractive(
      {
        command: 'vim notes.txt',
        expectedContextId: actor.snapshot.executionContextId,
        inputGrantMode: 'bounded',
      },
      fullContext,
    );
    if (!start.ok) throw new Error('expected start');
    const transactionId = (start.result.transaction as { id: string }).id;
    const grantId = start.result.inputGrantId as string;

    await pipeline.input(input(transactionId, grantId, 'cursor-input', ':wq\n'), fullContext);

    await expect(
      pipeline.finishInteractive({ transactionId, observedCursor: 'stale-cursor' }, fullContext),
    ).resolves.toMatchObject({ ok: false, error: 'OUTPUT_CURSOR_STALE' });
    expect(backend.writes).toHaveLength(2);
    await pipeline.clear();
    actor.dispose();
  });

  it('rejects transactional input and interrupt while finish is in flight', async () => {
    const { backend, actor, pipeline } = await createHarness();
    const start = await pipeline.startInteractive(
      {
        command: 'vim notes.txt',
        expectedContextId: actor.snapshot.executionContextId,
        inputGrantMode: 'bounded',
      },
      fullContext,
    );
    if (!start.ok) throw new Error('expected start');
    const transactionId = (start.result.transaction as { id: string }).id;
    const grantId = start.result.inputGrantId as string;
    const finish = pipeline.finishInteractive(
      { transactionId, observedCursor: start.result.nextCursor as string },
      fullContext,
    );
    await vi.waitFor(() => expect(backend.writes).toHaveLength(2));

    await expect(
      pipeline.input(input(transactionId, grantId, 'finish-race', 'late\n'), fullContext),
    ).resolves.toMatchObject({ ok: false, error: 'SESSION_BUSY' });
    await expect(pipeline.interrupt({ transactionId }, fullContext)).resolves.toMatchObject({
      ok: false,
      error: 'SESSION_BUSY',
    });
    const nonce = completionNonce(backend.writes[1]!);
    backend.emitData(`\x1b]777;TA;${nonce};0\x07`);
    await expect(finish).resolves.toMatchObject({ ok: true, result: { status: 'completed' } });
    expect(backend.writes).toHaveLength(2);
    await pipeline.clear();
    actor.dispose();
  });

  it('rejects interrupt after an interactive transaction settles unknown', async () => {
    const { backend, actor, pipeline } = await createPipelineWithInteractiveOptions({
      finishTimeoutMs: 5,
      completionDrainMs: 0,
      completionEchoGraceMs: 0,
    });
    const start = await pipeline.startInteractive(
      {
        command: 'node',
        expectedContextId: actor.snapshot.executionContextId,
        inputGrantMode: 'bounded',
      },
      fullContext,
    );
    if (!start.ok) throw new Error('expected start');
    const transactionId = (start.result.transaction as { id: string }).id;

    await expect(
      pipeline.finishInteractive(
        { transactionId, observedCursor: start.result.nextCursor as string },
        fullContext,
      ),
    ).resolves.toMatchObject({ ok: true, result: { status: 'unknown' } });
    await expect(pipeline.interrupt({ transactionId }, fullContext)).resolves.toMatchObject({
      ok: false,
      error: 'TRANSACTION_NOT_FOUND',
    });
    expect(backend.interrupted).toBe(0);
    await pipeline.clear();
    actor.dispose();
  });

  it('maps uncertain interactive startup writes and releases the lease without retrying', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('pipeline-start-unknown', backend, {
      title: 'test',
      terminalType: 'bash',
    });
    await actor.markPtyRunning();
    await actor.verifyEnvironment('posix', 'unix');
    const leases = new ExternalLeaseRegistry();
    const pipeline = new ExternalToolPipeline({
      actor,
      executor: new CommandExecutor(actor, { completionDrainMs: 0 }),
      leases,
    });
    backend.write = (data: string) => {
      backend.writes.push(data.slice(0, 4));
      throw new Error('backend write failed after a possible partial write');
    };
    const expectedContextId = actor.snapshot.executionContextId;

    await expect(
      pipeline.startInteractive(
        { command: 'sudo su -', expectedContextId, inputGrantMode: 'bounded' },
        fullContext,
      ),
    ).resolves.toMatchObject({ ok: false, error: 'INTERACTIVE_START_WRITE_UNKNOWN' });
    expect(pipeline.activeTransactionId).toBeUndefined();
    expect(leases.owner(actor.snapshot.id)).toBeUndefined();
    expect(actor.snapshot.executionContextId).not.toBe(expectedContextId);
    expect(actor.snapshot.environment.verificationStatus).toBe('unverified');
    expect(backend.writes).toEqual(['sudo']);
    await pipeline.clear();
    actor.dispose();
  });

  it('keeps transactional request deduplication ahead of context and grant checks', async () => {
    const { backend, actor, pipeline } = await createHarness();
    const start = await pipeline.startInteractive(
      {
        command: 'vim notes.txt',
        expectedContextId: actor.snapshot.executionContextId,
        inputGrantMode: 'one_shot',
      },
      fullContext,
    );
    if (!start.ok) throw new Error('expected start');
    const transactionId = (start.result.transaction as { id: string }).id;
    const grantId = start.result.inputGrantId as string;
    const request = input(transactionId, grantId, 'dedupe-after-terminal', ':wq\n');
    const first = await pipeline.input(request, fullContext);
    expect(first).toMatchObject({ ok: true });

    const observed = await pipeline.observe({}, fullContext);
    if (!observed.ok) throw new Error('expected observation');
    const finish = pipeline.finishInteractive(
      { transactionId, observedCursor: observed.result.nextCursor as string },
      fullContext,
    );
    await vi.waitFor(() => expect(backend.writes).toHaveLength(3));
    const nonce = completionNonce(backend.writes[2]!);
    backend.emitData(`\x1b]777;TA;${nonce};0\x07`);
    await expect(finish).resolves.toMatchObject({ ok: true, result: { status: 'completed' } });

    const replay = await pipeline.input(request, fullContext);
    expect(replay).toMatchObject({ ok: true, result: { sent: { textLength: 4 } } });
    expect(JSON.stringify(replay)).not.toContain(':wq');
    expect(backend.writes).toHaveLength(3);
    await pipeline.clear();
    actor.dispose();
  });

  it('rejects request IDs reused across input modes or grants', async () => {
    const { backend, actor, pipeline } = await createHarness();
    const start = await pipeline.startInteractive(
      {
        command: 'bash -i',
        expectedContextId: actor.snapshot.executionContextId,
        inputGrantMode: 'bounded',
      },
      fullContext,
    );
    if (!start.ok) throw new Error('expected start');
    const transactionId = (start.result.transaction as { id: string }).id;
    const grantId = start.result.inputGrantId as string;
    const first = await pipeline.input(
      input(transactionId, grantId, 'mode-conflict', 'one\n'),
      fullContext,
    );
    expect(first).toMatchObject({ ok: true });

    await expect(
      pipeline.input(
        {
          expectedContextId: actor.snapshot.executionContextId,
          inputRequestId: 'mode-conflict',
          keys: ['enter'],
        },
        fullContext,
      ),
    ).resolves.toMatchObject({ ok: false, error: 'POLICY_DENIED' });
    await expect(
      pipeline.input(
        input(transactionId, 'different-grant', 'mode-conflict', 'one\n'),
        fullContext,
      ),
    ).resolves.toMatchObject({ ok: false, error: 'POLICY_DENIED' });
    expect(backend.writes).toEqual(['bash -i\r', 'one\r']);
    await pipeline.clear();
    actor.dispose();
  });

  it('requires approval for interactive starts in managed mode and matches grant mode exactly', async () => {
    const { actor, pipeline } = await createHarness();
    const approvals: unknown[] = [];
    const managed = new ExternalToolPipeline({
      actor,
      executor: new CommandExecutor(actor, { completionDrainMs: 0 }),
      requestApproval: async (request) => {
        approvals.push(request);
        return 'allow_session';
      },
    });
    const command = 'sudo su -';
    const first = await managed.startInteractive(
      { command, expectedContextId: actor.snapshot.executionContextId, inputGrantMode: 'bounded' },
      { caller, mode: 'managed' },
    );
    expect(first).toMatchObject({ ok: true });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      command,
      kind: 'interactive',
      inputGrantMode: 'bounded',
      inputLimits: { maxCalls: 256, maxBytes: 256 * 1024 },
    });
    expect(JSON.stringify(approvals[0])).not.toContain('password');
    if (!first.ok) throw new Error('expected first interactive start');
    const firstTransactionId = (first.result.transaction as { id: string }).id;
    await expect(
      managed.interrupt({ transactionId: firstTransactionId }, { caller, mode: 'managed' }),
    ).resolves.toMatchObject({
      ok: true,
      result: { status: 'interrupted' },
    });
    await actor.verifyEnvironment('posix', 'unix');

    const second = await managed.startInteractive(
      { command, expectedContextId: actor.snapshot.executionContextId, inputGrantMode: 'bounded' },
      { caller, mode: 'managed' },
    );
    expect(second).toMatchObject({ ok: true });
    expect(approvals).toHaveLength(1);
    if (!second.ok) throw new Error('expected second interactive start');
    const secondTransactionId = (second.result.transaction as { id: string }).id;
    await expect(
      managed.interrupt({ transactionId: secondTransactionId }, { caller, mode: 'managed' }),
    ).resolves.toMatchObject({ ok: true, result: { status: 'interrupted' } });
    await actor.verifyEnvironment('posix', 'unix');

    const third = await managed.startInteractive(
      { command, expectedContextId: actor.snapshot.executionContextId, inputGrantMode: 'one_shot' },
      { caller, mode: 'managed' },
    );
    expect(third).toMatchObject({ ok: true });
    expect(approvals).toHaveLength(2);
    await managed.clear();
    await pipeline.clear();
    actor.dispose();
  });

  it('keeps full-mode input responses free of the submitted text while redacting output', async () => {
    const { backend, actor, pipeline } = await createHarness();
    const start = await pipeline.startInteractive(
      {
        command: 'sudo -S id',
        expectedContextId: actor.snapshot.executionContextId,
        inputGrantMode: 'one_shot',
      },
      fullContext,
    );
    if (!start.ok) throw new Error('expected start');
    const transactionId = (start.result.transaction as { id: string }).id;
    const grantId = start.result.inputGrantId as string;
    backend.emitData('super-secret-value\r\n');
    await flushActor();
    const result = await pipeline.input(
      input(transactionId, grantId, 'secret-input', 'super-secret-value\n'),
      fullContext,
    );
    expect(result).toMatchObject({ ok: true, result: { sent: { textLength: 19 } } });
    expect(JSON.stringify(result)).not.toContain('super-secret-value');
    expect(JSON.stringify(result)).toContain('[REDACTED]');
    await pipeline.clear();
    actor.dispose();
  });

  it('expires interactive transactions and grants after the configured idle timeout', async () => {
    vi.useFakeTimers();
    try {
      const { backend, actor, pipeline } = await createPipelineWithInteractiveOptions({
        idleTimeoutMs: 20,
        finishTimeoutMs: 100,
        completionDrainMs: 0,
        completionEchoGraceMs: 0,
      });
      const start = await pipeline.startInteractive(
        {
          command: 'bash -i',
          expectedContextId: actor.snapshot.executionContextId,
          inputGrantMode: 'bounded',
        },
        fullContext,
      );
      if (!start.ok) throw new Error('expected start');
      await vi.advanceTimersByTimeAsync(20);
      await expect(
        pipeline.wait(
          { transactionId: (start.result.transaction as { id: string }).id },
          fullContext,
        ),
      ).resolves.toMatchObject({ ok: true, result: { status: 'unknown' } });
      expect(backend.writes).toEqual(['bash -i\r']);
      await pipeline.clear();
      actor.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
