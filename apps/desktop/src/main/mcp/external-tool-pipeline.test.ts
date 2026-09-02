import { describe, expect, it, vi } from 'vitest';

import { createFakeTerminalBackend } from '@synapse-term/test-kit';
import type { ExternalCaller } from '@synapse-term/domain';
import { CommandExecutor, ShellProbe } from '@synapse-term/terminal-service';

import { SessionActor } from '@synapse-term/terminal-service';
import {
  ExternalToolPipeline,
  type ExternalToolResult,
  type McpToolContext,
} from './external-tool-pipeline.js';
import { SharingOutputHistory } from './sharing-output-history.js';

const caller: ExternalCaller = { kind: 'mcp', id: 'client-1' };

function frame(nonce: string, exitCode = 0): string {
  return `\x1b]777;TA;${nonce};${exitCode}\x07`;
}

async function flushActorQueue(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function executeCurrent(
  pipeline: ExternalToolPipeline,
  actor: SessionActor,
  input: { command: string; observationWindowMs?: number },
  context: McpToolContext,
) {
  return pipeline.execute(
    { ...input, expectedContextId: actor.snapshot.executionContextId },
    context,
  );
}

function transactionIdOf(result: ExternalToolResult<Record<string, unknown>>): string {
  if (
    !result.ok ||
    typeof result.result.transaction !== 'object' ||
    result.result.transaction === null
  ) {
    throw new Error('expected an accepted transaction');
  }
  if (!('id' in result.result.transaction) || typeof result.result.transaction.id !== 'string') {
    throw new Error('expected a transaction id');
  }
  return result.result.transaction.id;
}

async function createHarness(
  terminalType = 'bash',
  verifyEnvironment = true,
  completionDrainMs = 0,
) {
  const backend = createFakeTerminalBackend();
  const actor = new SessionActor('session-1', backend, {
    title: 'test',
    terminalType,
  });
  await actor.markPtyRunning();
  if (verifyEnvironment) {
    await actor.verifyEnvironment(
      /powershell|pwsh/i.test(terminalType) ? 'powershell' : 'posix',
      /powershell|pwsh/i.test(terminalType) ? 'windows' : 'unix',
    );
  }
  let sequence = 0;
  const nonces = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'];
  const executor = new CommandExecutor(actor, {
    idFactory: () => `transaction-${++sequence}`,
    nonceFactory: () => nonces.shift() ?? `n${sequence}`,
    observationWindowMs: 20,
    completionDrainMs,
  });
  return { actor, backend, executor };
}

describe('ExternalToolPipeline authorization matrix', () => {
  it('reports a running Session with an unverified environment as not_ready', async () => {
    const { actor, backend, executor } = await createHarness('PowerShell', false);
    const pipeline = new ExternalToolPipeline({ actor, executor });

    expect(pipeline.status()).toMatchObject({
      ok: true,
      result: {
        status: 'not_ready',
        environment: {
          dialect: 'unknown',
          platform: 'unknown',
          verificationStatus: 'unverified',
        },
      },
    });
    const status = pipeline.status();
    if (!status.ok) throw new Error('expected status response');
    expect(status.result.guidance).toContain('不会触发 Probe');
    expect(status.result.guidance).toContain('synapse_execute');
    expect(backend.writes).toEqual([]);
    actor.dispose();
  });

  it('observes repeatable Sharing history without a transaction', async () => {
    const { actor, backend, executor } = await createHarness();
    const pipeline = new ExternalToolPipeline({ actor, executor });
    const context: McpToolContext = { caller, mode: 'read_only' };
    backend.emitData('first output\r\n');
    await flushActorQueue();

    const first = await pipeline.observe({}, context);
    expect(first).toMatchObject({
      ok: true,
      result: {
        output: 'first output\r\n',
        hasMore: false,
        historyTruncated: false,
        executionContextId: actor.snapshot.executionContextId,
      },
    });
    if (!first.ok) throw new Error('expected first observation to succeed');
    if (typeof first.result.nextCursor !== 'string') throw new Error('expected next cursor');

    await expect(pipeline.observe({}, context)).resolves.toEqual(first);
    backend.emitData('second output\r\n');
    await flushActorQueue();
    await expect(
      pipeline.observe({ afterCursor: first.result.nextCursor }, context),
    ).resolves.toMatchObject({ ok: true, result: { output: 'second output\r\n' } });
    await expect(pipeline.observe({ tail: true, maxBytes: 15 }, context)).resolves.toMatchObject({
      ok: true,
      result: { output: 'second output\r\n' },
    });
    pipeline.clear();
    actor.dispose();
  });

  it('reports retention truncation while preserving a resynchronization cursor', async () => {
    const { actor, backend, executor } = await createHarness();
    const history = new SharingOutputHistory({
      sessionId: actor.snapshot.id,
      maxBytes: 6,
      maxPageBytes: 6,
    });
    const removeHistoryListener = actor.onEvent((event) => {
      if (event.type === 'pty_output') history.append(event.historyData ?? event.data);
    });
    const pipeline = new ExternalToolPipeline({ actor, executor, history });
    const context: McpToolContext = { caller, mode: 'read_only' };
    const boundary = history.read().nextCursor;
    backend.emitData('0123456789');
    await flushActorQueue();

    await expect(pipeline.observe({ afterCursor: boundary }, context)).resolves.toMatchObject({
      ok: true,
      result: {
        output: '456789',
        historyTruncated: true,
        earliestCursor: expect.any(String),
      },
    });
    removeHistoryListener();
    pipeline.clear();
    history.dispose();
    actor.dispose();
  });

  it('probes the current PTY before dispatching a command and uses the detected dialect', async () => {
    const { actor, backend, executor } = await createHarness('PowerShell', false);
    const pipeline = new ExternalToolPipeline({
      actor,
      executor,
      probe: new ShellProbe(actor, { nonceFactory: () => 'pipeline-posix', timeoutMs: 100 }),
    });
    const context: McpToolContext = { caller, mode: 'full' };

    const resultPromise = executeCurrent(pipeline, actor, { command: 'printf remote-ok' }, context);
    await vi.waitFor(() =>
      expect(backend.writes.join('')).toContain('echo __SYNAPSE_DIALECT_pipeline-posix__:$?\r'),
    );
    backend.emitData(
      'echo __SYNAPSE_DIALECT_pipeline-posix__:$?\r\n__SYNAPSE_DIALECT_pipeline-posix__:0\r\n',
    );
    await vi.waitFor(() => expect(backend.writes.join('')).toContain('printf remote-ok'));
    expect(backend.writes.join('')).not.toContain('[Console]::Write');
    backend.emitData(frame('n1'));

    await expect(resultPromise).resolves.toMatchObject({
      ok: true,
      result: { transaction: { command: 'printf remote-ok' } },
    });
    actor.dispose();
  });

  it('returns bounded execution metadata without exposing the completion nonce', async () => {
    const { actor, backend, executor } = await createHarness();
    const pipeline = new ExternalToolPipeline({ actor, executor });
    const context: McpToolContext = { caller, mode: 'full' };
    const initialPromise = executeCurrent(pipeline, actor, { command: 'printf result' }, context);
    await vi.waitFor(() => expect(backend.writes.join('')).toContain('printf result'));
    backend.emitData(`printf result\r\n${frame('n1', 7)}`);

    const initial = await initialPromise;
    expect(initial).toMatchObject({
      ok: true,
      result: {
        outputRange: {
          startCursor: expect.any(String),
          endCursor: expect.any(String),
        },
        executionContextId: expect.any(String),
        risk: 'read_only',
        confidence: 'high',
        reasons: expect.arrayContaining(['all commands match read-only rules']),
        requiresConfirmation: false,
      },
    });
    if (!initial.ok) throw new Error('expected initial external execution to succeed');
    const transaction = initial.result.transaction;
    if (
      typeof transaction !== 'object' ||
      transaction === null ||
      !('id' in transaction) ||
      typeof transaction.id !== 'string'
    ) {
      throw new Error('expected initial external execution to return a transaction id');
    }
    const final =
      initial.result.status === 'running'
        ? await pipeline.wait({ transactionId: transaction.id }, context)
        : initial;
    expect(final).toMatchObject({
      ok: true,
      result: {
        status: 'completed',
        nextCursor: expect.any(String),
        completion: { confirmed: true, exitCode: 7 },
      },
    });
    expect(JSON.stringify(final)).not.toContain('n1');
    pipeline.clear();
    actor.dispose();
  });

  it('preserves macOS stdout after a Windows PowerShell launch crosses into remote POSIX SSH', async () => {
    const { actor, backend, executor } = await createHarness('PowerShell', false, 10);
    const pipeline = new ExternalToolPipeline({
      actor,
      executor,
      probe: new ShellProbe(actor, { nonceFactory: () => 'pipeline-macos-probe', timeoutMs: 100 }),
    });
    const context: McpToolContext = { caller, mode: 'full' };

    const resultPromise = executeCurrent(pipeline, actor, { command: 'uname -s' }, context);
    await vi.waitFor(() => expect(backend.writes.join('')).toContain('pipeline-macos-probe'));
    backend.emitData(
      'echo __SYNAPSE_DIALECT_pipeline-macos-probe__:$?\r\n' +
        '__SYNAPSE_DIALECT_pipeline-macos-probe__:0\r\n',
    );
    await vi.waitFor(() => expect(backend.writes.join('')).toContain('uname -s'));
    backend.emitData(`uname -s\r\n${frame('n1')}`);
    await flushActorQueue();
    backend.emitData('Darwin\r\n');

    const initial = await resultPromise;
    expect(initial).toMatchObject({ ok: true });
    if (!initial.ok) throw new Error('expected initial external execution to succeed');
    const transaction = initial.result.transaction;
    if (
      typeof transaction !== 'object' ||
      transaction === null ||
      !('id' in transaction) ||
      typeof transaction.id !== 'string'
    ) {
      throw new Error('expected initial external execution to return a transaction id');
    }

    const result = await pipeline.wait({ transactionId: transaction.id }, context);
    await expect(Promise.resolve(result)).resolves.toMatchObject({
      ok: true,
      result: {
        status: 'completed',
        output: expect.stringContaining('Darwin'),
      },
    });
    if (!result.ok) throw new Error('expected external execution to succeed');
    expect(result.result.output).toContain('uname -s');
    expect(result.result.output).not.toContain('__SYNAPSE_DIALECT_');
    expect(result.result.output).not.toContain('\u001b]777;TA;');
    actor.dispose();
  });

  it('does not dispatch a user command when the current PTY probe times out', async () => {
    const { actor, backend, executor } = await createHarness('PowerShell', false);
    const pipeline = new ExternalToolPipeline({
      actor,
      executor,
      probe: new ShellProbe(actor, { nonceFactory: () => 'pipeline-timeout', timeoutMs: 10 }),
    });
    const context: McpToolContext = { caller, mode: 'full' };

    await expect(
      executeCurrent(pipeline, actor, { command: 'Write-Output never' }, context),
    ).resolves.toMatchObject({
      ok: false,
      error: 'SESSION_NOT_READY',
    });
    expect(backend.writes).toEqual(['echo __SYNAPSE_DIALECT_pipeline-timeout__:$?\r']);
    actor.dispose();
  });

  it('stops before dispatch when the user changes the PTY during environment probing', async () => {
    const { actor, backend, executor } = await createHarness('PowerShell', false);
    const pipeline = new ExternalToolPipeline({
      actor,
      executor,
      probe: new ShellProbe(actor, { nonceFactory: () => 'probe-user-race', timeoutMs: 100 }),
    });
    const context: McpToolContext = { caller, mode: 'full' };
    const expectedContextId = actor.snapshot.executionContextId;

    const pending = pipeline.execute({ command: 'uname -s', expectedContextId }, context);
    await vi.waitFor(() => expect(backend.writes.join('')).toContain('probe-user-race'));
    await actor.writeUser('ssh host\r');

    await expect(pending).resolves.toMatchObject({ error: 'EXECUTION_CONTEXT_STALE' });
    expect(backend.writes).toEqual(['echo __SYNAPSE_DIALECT_probe-user-race__:$?\r', 'ssh host\r']);
    expect(backend.writes.join('')).not.toContain('uname -s');
    pipeline.clear();
    actor.dispose();
  });

  it('revalidates the execution context after approval before dispatch', async () => {
    const { actor, backend, executor } = await createHarness();
    let approvalRequested!: () => void;
    let resolveApproval!: () => void;
    const approvalReady = new Promise<void>((resolve) => {
      approvalRequested = resolve;
    });
    const approvalGate = new Promise<void>((resolve) => {
      resolveApproval = resolve;
    });
    const pipeline = new ExternalToolPipeline({
      actor,
      executor,
      requestApproval: async () => {
        approvalRequested();
        await approvalGate;
        return 'allow_once';
      },
    });
    const context: McpToolContext = { caller, mode: 'managed' };
    const expectedContextId = actor.snapshot.executionContextId;

    const pending = pipeline.execute(
      { command: 'deploy-production.sh', expectedContextId },
      context,
    );
    await approvalReady;
    await actor.writeUser('local input\r');
    resolveApproval();

    await expect(pending).resolves.toMatchObject({ error: 'EXECUTION_CONTEXT_STALE' });
    expect(backend.writes).toEqual(['local input\r']);
    expect(backend.writes.join('')).not.toContain('deploy-production.sh');
    pipeline.clear();
    actor.dispose();
  });

  it('uses the Session Shell type when classifying PowerShell commands', async () => {
    const { actor, backend, executor } = await createHarness('PowerShell');
    let approvalRequests = 0;
    const pipeline = new ExternalToolPipeline({
      actor,
      executor,
      requestApproval: async () => {
        approvalRequests += 1;
        return 'denied';
      },
    });
    const context: McpToolContext = { caller, mode: 'managed' };

    const result = await executeCurrent(pipeline, actor, { command: 'Get-ChildItem' }, context);
    backend.emitData(frame('n1'));
    await Promise.resolve();

    expect(result).toMatchObject({ ok: true });
    expect(approvalRequests).toBe(0);
  });

  it('rejects a PowerShell command before writing it to a Git Bash Session', async () => {
    const { actor, backend, executor } = await createHarness('Git Bash');
    const pipeline = new ExternalToolPipeline({ actor, executor });
    const context: McpToolContext = { caller, mode: 'full' };

    const result = await executeCurrent(
      pipeline,
      actor,
      { command: 'Get-CimInstance Win32_OperatingSystem' },
      context,
    );
    expect(result).toMatchObject({
      ok: false,
      error: 'SHELL_MISMATCH',
      message: expect.stringContaining('POSIX'),
    });
    if (!result.ok) expect(result.message).not.toContain('启动提示');
    if (!result.ok) expect(result.message).not.toMatch(/^SHELL_MISMATCH:/);
    expect(backend.writes).toEqual([]);
  });

  it('does not dispatch after an approval resolves following pipeline clear', async () => {
    const { actor, backend, executor } = await createHarness();
    let resolveApproval!: () => void;
    let approvalRequested!: () => void;
    const approvalReady = new Promise<void>((resolve) => {
      approvalRequested = resolve;
    });
    const approvalGate = new Promise<void>((resolve) => {
      resolveApproval = resolve;
    });
    const pipeline = new ExternalToolPipeline({
      actor,
      executor,
      requestApproval: async () => {
        approvalRequested();
        await approvalGate;
        return 'allow_once';
      },
    });

    const pending = executeCurrent(
      pipeline,
      actor,
      { command: 'deploy-production.sh' },
      { caller, mode: 'managed' },
    );
    await approvalReady;
    pipeline.clear();
    resolveApproval();

    await expect(pending).resolves.toMatchObject({ ok: false, error: 'SESSION_EXPIRED' });
    expect(backend.writes).toEqual([]);
    actor.dispose();
  });

  it('allows an explicitly invoked PowerShell command in a Git Bash Session', async () => {
    const { actor, backend, executor } = await createHarness('Git Bash');
    const pipeline = new ExternalToolPipeline({ actor, executor });
    const command = 'powershell.exe -NoProfile -Command "Get-CimInstance Win32_OperatingSystem"';
    const context: McpToolContext = { caller, mode: 'full' };

    const result = await executeCurrent(pipeline, actor, { command }, context);

    expect(result).toMatchObject({
      ok: true,
      result: { transaction: { command } },
    });
    expect(backend.writes.join('')).toContain(command);
    backend.emitData(frame('n1'));
    await Promise.resolve();
  });

  it('surfaces an auditability error without writing an invalid command', async () => {
    const { actor, backend, executor } = await createHarness();
    const pipeline = new ExternalToolPipeline({ actor, executor });
    const context: McpToolContext = { caller, mode: 'full' };

    await expect(
      executeCurrent(pipeline, actor, { command: 'printf \u0000' }, context),
    ).resolves.toMatchObject({ ok: false, error: 'COMMAND_NOT_AUDITABLE' });
    expect(backend.writes).toEqual([]);
  });

  it('rejects known interactive commands before requesting approval', async () => {
    const { actor, backend, executor } = await createHarness();
    let approvalRequests = 0;
    const pipeline = new ExternalToolPipeline({
      actor,
      executor,
      requestApproval: async () => {
        approvalRequests += 1;
        return 'allow_once';
      },
    });

    await expect(
      executeCurrent(
        pipeline,
        actor,
        { command: 'docker exec -it app sh' },
        { caller, mode: 'managed' },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: 'INTERACTIVE_COMMAND_UNSUPPORTED',
    });
    expect(approvalRequests).toBe(0);
    expect(backend.writes).toEqual([]);
    pipeline.clear();
    actor.dispose();
  });

  it('allows observations but rejects every write in read-only mode', async () => {
    const { actor, backend, executor } = await createHarness();
    const pipeline = new ExternalToolPipeline({ actor, executor });
    const context: McpToolContext = { caller, mode: 'read_only' };

    await expect(pipeline.observe({}, context)).resolves.toMatchObject({ ok: true });
    await expect(
      executeCurrent(pipeline, actor, { command: 'ls' }, context),
    ).resolves.toMatchObject({
      ok: false,
      error: 'POLICY_DENIED',
    });
    expect(backend.writes).toEqual([]);
  });

  it('auto-allows low risk and mutating commands under managed mode', async () => {
    const { actor, backend, executor } = await createHarness();
    const pipeline = new ExternalToolPipeline({ actor, executor });
    const context: McpToolContext = { caller, mode: 'managed' };
    const observed = await executeCurrent(pipeline, actor, { command: 'ls' }, context);
    backend.emitData(frame('n1'));
    await Promise.resolve();

    expect(observed).toMatchObject({ ok: true });
    const first = await pipeline.wait({ transactionId: 'transaction-1' }, context);
    expect(first.ok).toBe(true);

    const mutation = await executeCurrent(pipeline, actor, { command: 'npm test' }, context);
    backend.emitData(frame('n2'));
    await Promise.resolve();
    expect(mutation).toMatchObject({ ok: true });
  });

  it('escalates unknown commands once, per call, or for the exact session grant', async () => {
    const { actor, backend, executor } = await createHarness();
    let approvals = 0;
    const pipeline = new ExternalToolPipeline({
      actor,
      executor,
      requestApproval: async () => {
        approvals += 1;
        return approvals <= 2 ? 'allow_once' : approvals === 3 ? 'allow_session' : 'denied';
      },
    });
    const context: McpToolContext = { caller, mode: 'managed' };

    const once = await executeCurrent(
      pipeline,
      actor,
      { command: 'deploy-production.sh' },
      context,
    );
    backend.emitData(frame('n1'));
    await Promise.resolve();
    expect(once).toMatchObject({ ok: true });
    expect(approvals).toBe(1);
    await pipeline.wait({ transactionId: 'transaction-1' }, context);

    await executeCurrent(pipeline, actor, { command: 'deploy-production.sh' }, context);
    backend.emitData(frame('n2'));
    await Promise.resolve();
    expect(approvals).toBe(2);
    await pipeline.wait({ transactionId: 'transaction-2' }, context);

    const granted = await executeCurrent(pipeline, actor, { command: 'unique-command' }, context);
    backend.emitData(frame('n3'));
    await Promise.resolve();
    expect(granted).toMatchObject({ ok: true });
    expect(approvals).toBe(3);
    await pipeline.wait({ transactionId: 'transaction-3' }, context);

    const repeat = await executeCurrent(pipeline, actor, { command: 'unique-command' }, context);
    backend.emitData(frame('n4'));
    await Promise.resolve();
    expect(repeat).toMatchObject({ ok: true });
    expect(approvals).toBe(3);
    await pipeline.wait({ transactionId: 'transaction-4' }, context);

    await expect(
      executeCurrent(pipeline, actor, { command: 'different-command' }, { ...context }),
    ).resolves.toMatchObject({ ok: false, error: 'APPROVAL_DENIED' });
    expect(approvals).toBe(4);
  });

  it('maps an unexpected approval failure to a safe stable error', async () => {
    const { actor, backend, executor } = await createHarness();
    const pipeline = new ExternalToolPipeline({
      actor,
      executor,
      requestApproval: async () => {
        throw new Error('NOT_A_STABLE_CODE: raw PTY output secret and probe nonce');
      },
    });

    const result = await executeCurrent(
      pipeline,
      actor,
      { command: 'deploy-production.sh' },
      { caller, mode: 'managed' },
    );

    expect(result).toMatchObject({ ok: false, error: 'APPROVAL_DENIED' });
    if (!result.ok) {
      expect(result.message).not.toContain('NOT_A_STABLE_CODE');
      expect(result.message).not.toContain('raw PTY output');
      expect(result.message).not.toContain('probe nonce');
    }
    expect(backend.writes).toEqual([]);
    pipeline.clear();
    actor.dispose();
  });

  it('allows all commands in full mode but still redacts output', async () => {
    const { actor, backend, executor } = await createHarness();
    const pipeline = new ExternalToolPipeline({ actor, executor });
    const context: McpToolContext = { caller, mode: 'full' };
    const observed = await executeCurrent(pipeline, actor, { command: 'rm -rf build' }, context);
    backend.emitData('API_KEY=super-secret-value');
    backend.emitData(frame('n1'));
    await Promise.resolve();

    expect(observed).toMatchObject({ ok: true });
    const result = await pipeline.wait({ transactionId: 'transaction-1' }, context);
    if (!result.ok) throw new Error('expected success');
    expect(JSON.stringify(result.result)).not.toContain('super-secret-value');
    expect(JSON.stringify(result.result)).toContain('[REDACTED]');
  });

  it('returns a stale-context error before any write when execute uses an old observation', async () => {
    const { actor, backend, executor } = await createHarness();
    const pipeline = new ExternalToolPipeline({ actor, executor });
    const staleContextId = actor.snapshot.executionContextId;
    await actor.writeUser('local command\r');

    await expect(
      pipeline.execute(
        { command: 'rm -rf build', expectedContextId: staleContextId },
        { caller, mode: 'full' },
      ),
    ).resolves.toMatchObject({ error: 'EXECUTION_CONTEXT_STALE' });
    expect(backend.writes).toEqual(['local command\r']);
    pipeline.clear();
    actor.dispose();
  });

  it('allows only one external transaction per shared Session', async () => {
    const { actor, backend, executor } = await createHarness();
    const pipeline = new ExternalToolPipeline({ actor, executor });
    const context: McpToolContext = { caller, mode: 'full' };

    const first = executeCurrent(pipeline, actor, { command: 'sleep 100' }, context);
    await vi.waitFor(() => expect(backend.writes.join('')).toContain('sleep 100'));
    const second = await executeCurrent(pipeline, actor, { command: 'another command' }, context);

    expect(second).toMatchObject({ ok: false, error: 'SESSION_BUSY' });
    expect(backend.writes.join('')).not.toContain('another command');
    backend.emitData(frame('n1'));
    await expect(first).resolves.toMatchObject({ ok: true });
    pipeline.clear();
    actor.dispose();
  });

  it('returns the settled interruption result without claiming remote termination', async () => {
    const { actor, backend, executor } = await createHarness();
    const pipeline = new ExternalToolPipeline({ actor, executor });
    const context: McpToolContext = { caller, mode: 'full' };
    const first = executeCurrent(pipeline, actor, { command: 'sleep 100' }, context);
    await vi.waitFor(() => expect(backend.writes.join('')).toContain('sleep 100'));
    const initial = await first;
    const transactionId = transactionIdOf(initial);

    const interrupted = await pipeline.interrupt({ transactionId }, context);

    expect(interrupted).toMatchObject({
      ok: true,
      result: { interrupted: true, status: 'interrupted' },
    });
    expect(backend.interrupted).toBe(1);
    const final = executor.get(transactionId);
    expect(final).toMatchObject({
      status: 'interrupted',
      safeToResubmit: false,
      transaction: { status: 'interrupted' },
    });
    pipeline.clear();
    actor.dispose();
  });

  it('does not claim interruption when the PTY interrupt fails', async () => {
    const { actor, backend, executor } = await createHarness();
    backend.interrupt = () => {
      throw new Error('interrupt unavailable');
    };
    const pipeline = new ExternalToolPipeline({ actor, executor });
    const context: McpToolContext = { caller, mode: 'full' };
    const pending = executeCurrent(pipeline, actor, { command: 'sleep 100' }, context);
    await vi.waitFor(() => expect(backend.writes.join('')).toContain('sleep 100'));
    const initial = await pending;
    const transactionId = transactionIdOf(initial);

    await expect(pipeline.interrupt({ transactionId }, context)).resolves.toMatchObject({
      ok: true,
      result: { interrupted: false, status: 'unknown' },
    });
    pipeline.clear();
    actor.dispose();
  });
});
