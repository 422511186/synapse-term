import { describe, expect, it, vi } from 'vitest';

import { createFakeTerminalBackend } from '@synapse-term/test-kit';
import type { ExternalCaller } from '@synapse-term/domain';
import { CommandExecutor, ShellProbe } from '@synapse-term/terminal-service';

import { SessionActor } from '@synapse-term/terminal-service';
import { ExternalToolPipeline, type McpToolContext } from './external-tool-pipeline.js';

const caller: ExternalCaller = { kind: 'mcp', id: 'client-1' };

function frame(nonce: string, exitCode = 0): string {
  return `\x1b]777;TA;${nonce};${exitCode}\x07`;
}

async function flushActorQueue(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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

  it('probes the current PTY before dispatching a command and uses the detected dialect', async () => {
    const { actor, backend, executor } = await createHarness('PowerShell', false);
    const pipeline = new ExternalToolPipeline({
      actor,
      executor,
      probe: new ShellProbe(actor, { nonceFactory: () => 'pipeline-posix', timeoutMs: 100 }),
    });
    const context: McpToolContext = { caller, mode: 'full' };

    const resultPromise = pipeline.execute({ command: 'printf remote-ok' }, context);
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

  it('preserves macOS stdout after a Windows PowerShell launch crosses into remote POSIX SSH', async () => {
    const { actor, backend, executor } = await createHarness('PowerShell', false, 10);
    const pipeline = new ExternalToolPipeline({
      actor,
      executor,
      probe: new ShellProbe(actor, { nonceFactory: () => 'pipeline-macos-probe', timeoutMs: 100 }),
    });
    const context: McpToolContext = { caller, mode: 'full' };

    const resultPromise = pipeline.execute({ command: 'uname -s' }, context);
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
      pipeline.execute({ command: 'Write-Output never' }, context),
    ).resolves.toMatchObject({
      ok: false,
      error: 'SESSION_NOT_READY',
    });
    expect(backend.writes).toEqual(['echo __SYNAPSE_DIALECT_pipeline-timeout__:$?\r']);
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

    const result = await pipeline.execute({ command: 'Get-ChildItem' }, context);
    backend.emitData(frame('n1'));
    await Promise.resolve();

    expect(result).toMatchObject({ ok: true });
    expect(approvalRequests).toBe(0);
  });

  it('rejects a PowerShell command before writing it to a Git Bash Session', async () => {
    const { actor, backend, executor } = await createHarness('Git Bash');
    const pipeline = new ExternalToolPipeline({ actor, executor });
    const context: McpToolContext = { caller, mode: 'full' };

    const result = await pipeline.execute(
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

    const pending = pipeline.execute(
      { command: 'deploy-production.sh' },
      { caller, mode: 'managed' },
    );
    await approvalReady;
    pipeline.clear();
    resolveApproval();

    await expect(pending).rejects.toThrow(/SESSION_EXPIRED/);
    expect(backend.writes).toEqual([]);
    actor.dispose();
  });

  it('allows an explicitly invoked PowerShell command in a Git Bash Session', async () => {
    const { actor, backend, executor } = await createHarness('Git Bash');
    const pipeline = new ExternalToolPipeline({ actor, executor });
    const command = 'powershell.exe -NoProfile -Command "Get-CimInstance Win32_OperatingSystem"';
    const context: McpToolContext = { caller, mode: 'full' };

    const result = await pipeline.execute({ command }, context);

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

    await expect(pipeline.execute({ command: 'printf \u0000' }, context)).rejects.toThrow(
      /^COMMAND_NOT_AUDITABLE:/,
    );
    expect(backend.writes).toEqual([]);
  });

  it('allows observations but rejects every write in read-only mode', async () => {
    const { actor, backend, executor } = await createHarness();
    const pipeline = new ExternalToolPipeline({ actor, executor });
    const context: McpToolContext = { caller, mode: 'read_only' };

    await expect(pipeline.observe({}, context)).resolves.toMatchObject({ ok: true });
    await expect(pipeline.execute({ command: 'ls' }, context)).resolves.toMatchObject({
      ok: false,
      error: 'POLICY_DENIED',
    });
    expect(backend.writes).toEqual([]);
  });

  it('auto-allows low risk and mutating commands under managed mode', async () => {
    const { actor, backend, executor } = await createHarness();
    const pipeline = new ExternalToolPipeline({ actor, executor });
    const context: McpToolContext = { caller, mode: 'managed' };
    const observed = await pipeline.execute({ command: 'ls' }, context);
    backend.emitData(frame('n1'));
    await Promise.resolve();

    expect(observed).toMatchObject({ ok: true });
    const first = await pipeline.wait({ transactionId: 'transaction-1' }, context);
    expect(first.ok).toBe(true);

    const mutation = await pipeline.execute({ command: 'npm test' }, context);
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

    const once = await pipeline.execute({ command: 'deploy-production.sh' }, context);
    backend.emitData(frame('n1'));
    await Promise.resolve();
    expect(once).toMatchObject({ ok: true });
    expect(approvals).toBe(1);

    await pipeline.execute({ command: 'deploy-production.sh' }, context);
    backend.emitData(frame('n2'));
    await Promise.resolve();
    expect(approvals).toBe(2);

    const granted = await pipeline.execute({ command: 'unique-command' }, context);
    backend.emitData(frame('n3'));
    await Promise.resolve();
    expect(granted).toMatchObject({ ok: true });
    expect(approvals).toBe(3);

    const repeat = await pipeline.execute({ command: 'unique-command' }, context);
    backend.emitData(frame('n4'));
    await Promise.resolve();
    expect(repeat).toMatchObject({ ok: true });
    expect(approvals).toBe(3);

    await expect(
      pipeline.execute({ command: 'different-command' }, { ...context }),
    ).rejects.toThrow(/APPROVAL_DENIED/);
    expect(approvals).toBe(4);
  });

  it('allows all commands in full mode but still redacts output', async () => {
    const { actor, backend, executor } = await createHarness();
    const pipeline = new ExternalToolPipeline({ actor, executor });
    const context: McpToolContext = { caller, mode: 'full' };
    const observed = await pipeline.execute({ command: 'rm -rf build' }, context);
    backend.emitData('API_KEY=super-secret-value');
    backend.emitData(frame('n1'));
    await Promise.resolve();

    expect(observed).toMatchObject({ ok: true });
    const result = await pipeline.wait({ transactionId: 'transaction-1' }, context);
    if (!result.ok) throw new Error('expected success');
    expect(JSON.stringify(result.result)).not.toContain('super-secret-value');
    expect(JSON.stringify(result.result)).toContain('[REDACTED]');
  });
});
