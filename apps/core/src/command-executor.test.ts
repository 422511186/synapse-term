import { describe, expect, it, vi } from 'vitest';

import type { ExecutionDialect } from '@terminal-agent/domain';
import { FakeClock, FakePty } from '@terminal-agent/test-kit';

import { SessionActor } from './session-actor.js';
import { CommandExecutor, type ExecutorScheduler } from './command-executor.js';
import { ShellProbe } from './shell-probe.js';
import { TerminalModel } from './terminal-model.js';

class DeferredTerminalModel extends TerminalModel {
  readonly started: Promise<void>;
  readonly #releasePromise: Promise<void>;
  #markStarted!: () => void;
  #release!: () => void;

  constructor() {
    super({ columns: 80, rows: 24 });
    this.started = new Promise<void>((resolve) => {
      this.#markStarted = resolve;
    });
    this.#releasePromise = new Promise<void>((resolve) => {
      this.#release = resolve;
    });
  }

  override async write(data: string | Uint8Array): Promise<void> {
    this.#markStarted();
    await this.#releasePromise;
    await super.write(data);
  }

  release(): void {
    this.#release();
  }
}

function schedulerFor(clock: FakeClock): ExecutorScheduler {
  return {
    schedule(callback, delayMs) {
      const timer = clock.setTimeout(callback, delayMs);
      return { dispose: () => clock.clearTimeout(timer) };
    },
  };
}

async function createReadyAgentSession(executionDialect: ExecutionDialect = 'posix') {
  const pty = new FakePty(123);
  const actor = new SessionActor('session-1', pty, { executionDialect });
  await actor.markPtyRunning();
  await actor.transitionShell('probing');
  await actor.transitionShell('ready');
  // Verify the environment so dispatch preconditions pass
  await actor.verifyCurrentEnvironment(
    executionDialect === 'observe_only' ? 'posix' : executionDialect,
    'unix',
  );
  const lease = await actor.grantAgentLease('task-1', 0);
  if (!lease.ok) throw new Error('expected agent lease');
  return { pty, actor, leaseEpoch: lease.value.lease.epoch };
}

async function waitForDispatch(actor: SessionActor, pty: FakePty): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await Promise.resolve();
    await actor.idle();
    if (
      pty.writes.some((write) => write.includes('__TA_START__') || write.includes('__TA_DONE_'))
    ) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('command payload was not fully dispatched');
}

async function startCapture(actor: SessionActor, pty: FakePty): Promise<void> {
  pty.emitData('\u001b]777;TA_START\u0007');
  await actor.idle();
}

describe('CommandExecutor', () => {
  it('does not use a microtask polling loop while the actor queue is waiting on I/O', async () => {
    const pty = new FakePty(124);
    const terminal = new DeferredTerminalModel();
    const actor = new SessionActor('initialization-yield-session', pty, {
      executionDialect: 'posix',
      terminal,
    });
    await actor.markPtyRunning();
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('posix', 'unix');
    const lease = await actor.grantAgentLease('task-1', 0);
    if (!lease.ok) throw new Error('expected agent lease');

    pty.emitData('pending terminal output');
    await terminal.started;

    const executor = new CommandExecutor(actor, {
      nonceFactory: () => 'txn-initialization-yield',
      observationWindowMs: 5_000,
    });
    const queueMicrotaskSpy = vi
      .spyOn(globalThis, 'queueMicrotask')
      .mockImplementation(() => undefined);

    let execution!: Promise<unknown>;
    let assertionError: unknown;
    try {
      execution = executor.execute({
        transactionId: 'transaction-initialization-yield',
        taskId: 'task-1',
        leaseEpoch: lease.value.lease.epoch,
        command: 'printf ready',
        risk: 'read_only',
      });
      expect(queueMicrotaskSpy).not.toHaveBeenCalled();
    } catch (error) {
      assertionError = error;
    } finally {
      queueMicrotaskSpy.mockRestore();
    }

    terminal.release();
    await waitForDispatch(actor, pty);
    pty.emitData('\u001b]777;TA;txn-initialization-yield;0\u0007');
    await actor.idle();

    if (assertionError !== undefined) {
      actor.dispose();
      throw assertionError;
    }

    await expect(execution).resolves.toMatchObject({
      status: 'completed',
      transaction: { exitCode: 0 },
    });
    actor.dispose();
  });

  it('completes a Git Bash command despite split cursor redraw output', async () => {
    const { pty, actor, leaseEpoch } = await createReadyAgentSession();
    const executor = new CommandExecutor(actor, {
      nonceFactory: () => 'txn-git-bash-redraw',
      observationWindowMs: 100,
    });

    const execution = executor.execute({
      transactionId: 'transaction-git-bash-redraw',
      taskId: 'task-1',
      leaseEpoch,
      command: 'wmic OS get FreePhysicalMemory',
      risk: 'read_only',
    });
    await waitForDispatch(actor, pty);
    await startCapture(actor, pty);

    pty.emitData('\u001b[1A');
    await actor.idle();
    pty.emitData('\u001b[1A\u001b[2K\u001b[1G');
    await actor.idle();
    pty.emitData(
      'MINGW64_NT-10.0-17763\r\nFreePhysicalMemory=123\r\n$ \u001b]777;TA;txn-git-bash-redraw;0\u0007',
    );

    await expect(execution).resolves.toMatchObject({
      status: 'completed',
      transaction: { status: 'completed', exitCode: 0 },
    });
    actor.dispose();
  });

  it('wraps a PowerShell transaction without POSIX syntax', async () => {
    const { pty, actor, leaseEpoch } = await createReadyAgentSession('powershell');
    const executor = new CommandExecutor(actor, {
      nonceFactory: () => 'txn-powershell',
      scheduler: schedulerFor(new FakeClock(0)),
      observationWindowMs: 100,
    });

    const execution = executor.execute({
      transactionId: 'transaction-powershell',
      taskId: 'task-1',
      leaseEpoch,
      command: 'Get-Location',
      risk: 'read_only',
    });
    await waitForDispatch(actor, pty);

    const dispatched = pty.writes.join('');
    expect(dispatched).toContain('. {');
    expect(dispatched).not.toContain('FromBase64String');
    expect(dispatched).not.toContain('[ScriptBlock]::Create');
    expect(dispatched).not.toMatch(/\beval\b|\bprintf\b|\bunset\b/);
    pty.emitData('C:\\work\u001b]777;TA;txn-powershell;0\u0007');
    await expect(execution).resolves.toMatchObject({
      status: 'completed',
      transaction: { exitCode: 0 },
    });
  });

  it('serializes one active transaction and completes only on its matching nonce', async () => {
    const { pty, actor, leaseEpoch } = await createReadyAgentSession();
    const executor = new CommandExecutor(actor, {
      nonceFactory: () => 'txn-1',
      scheduler: schedulerFor(new FakeClock(0)),
      observationWindowMs: 100,
    });

    const first = executor.execute({
      transactionId: 'transaction-1',
      taskId: 'task-1',
      leaseEpoch,
      command: 'printf ok',
      risk: 'read_only',
    });
    await expect(
      executor.execute({
        transactionId: 'transaction-2',
        taskId: 'task-1',
        leaseEpoch,
        command: 'printf second',
        risk: 'read_only',
      }),
    ).rejects.toMatchObject({ code: 'command_transaction_conflict' });

    await waitForDispatch(actor, pty);
    expect(actor.snapshot.shell).toBe('executing');
    expect(executor.activeTransactionId).toBe('transaction-1');
    expect(pty.writes.join('')).toContain("'__TA_'");

    await startCapture(actor, pty);
    pty.emitData('before\u001b]777;TA;other;0\u0007');
    await actor.idle();
    pty.emitData('ok\u001b]777;TA;txn-1;7\u0007');

    await expect(first).resolves.toMatchObject({
      status: 'completed',
      transaction: {
        id: 'transaction-1',
        status: 'completed',
        exitCode: 7,
        nonce: 'txn-1',
      },
    });
    expect(executor.activeTransactionId).toBeUndefined();
    expect(actor.snapshot.shell).toBe('ready');
    await expect(executor.wait({ transactionId: 'transaction-1' })).resolves.toMatchObject({
      status: 'completed',
      output: { text: expect.stringContaining('ok') },
    });
  });

  it('returns running after the observation window and lets wait receive completion', async () => {
    const { pty, actor, leaseEpoch } = await createReadyAgentSession();
    const clock = new FakeClock(0);
    const executor = new CommandExecutor(actor, {
      nonceFactory: () => 'txn-running',
      scheduler: schedulerFor(clock),
      observationWindowMs: 100,
      hardDeadlineMs: 500,
    });

    const execute = executor.execute({
      transactionId: 'transaction-running',
      taskId: 'task-1',
      leaseEpoch,
      command: 'sleep 10',
      risk: 'read_only',
    });
    await waitForDispatch(actor, pty);
    clock.advanceBy(100);
    await expect(execute).resolves.toMatchObject({
      status: 'running',
      transaction: { status: 'running' },
    });

    const wait = executor.wait({ transactionId: 'transaction-running' });
    pty.emitData('done\u001b]777;TA;txn-running;0\u0007');
    await expect(wait).resolves.toMatchObject({
      status: 'completed',
      transaction: { status: 'completed', exitCode: 0 },
    });
  });

  it('reports a hard deadline without interrupting the PTY', async () => {
    const { pty, actor, leaseEpoch } = await createReadyAgentSession();
    const clock = new FakeClock(0);
    const warnings: string[] = [];
    const executor = new CommandExecutor(actor, {
      nonceFactory: () => 'txn-deadline',
      scheduler: schedulerFor(clock),
      observationWindowMs: 10,
      hardDeadlineMs: 50,
    });
    executor.onEvent((event) => {
      if (event.type === 'hard_deadline') warnings.push(event.transactionId);
    });

    const execute = executor.execute({
      transactionId: 'transaction-deadline',
      taskId: 'task-1',
      leaseEpoch,
      command: 'sleep 10',
      risk: 'read_only',
    });
    await waitForDispatch(actor, pty);
    clock.advanceBy(10);
    await execute;
    clock.advanceBy(40);

    expect(warnings).toEqual(['transaction-deadline']);
    expect(pty.interruptCount).toBe(0);
    pty.emitData('\u001b]777;TA;txn-deadline;0\u0007');
    await expect(executor.wait({ transactionId: 'transaction-deadline' })).resolves.toMatchObject({
      status: 'completed',
    });
  });

  it('marks a missing completion frame as shell_lost when the PTY exits', async () => {
    const { pty, actor, leaseEpoch } = await createReadyAgentSession();
    const executor = new CommandExecutor(actor, {
      nonceFactory: () => 'txn-lost',
      scheduler: schedulerFor(new FakeClock(0)),
      observationWindowMs: 100,
    });

    const execute = executor.execute({
      transactionId: 'transaction-lost',
      taskId: 'task-1',
      leaseEpoch,
      command: 'exit 3',
      risk: 'read_only',
    });
    await waitForDispatch(actor, pty);
    pty.emitExit({ exitCode: 3 });

    await expect(execute).resolves.toMatchObject({
      status: 'shell_lost',
      transaction: { status: 'shell_lost' },
    });
  });

  it('interrupts a command as a separate terminal action', async () => {
    const { pty, actor, leaseEpoch } = await createReadyAgentSession();
    const executor = new CommandExecutor(actor, {
      nonceFactory: () => 'txn-interrupt',
      scheduler: schedulerFor(new FakeClock(0)),
      observationWindowMs: 100,
    });

    const execute = executor.execute({
      transactionId: 'transaction-interrupt',
      taskId: 'task-1',
      leaseEpoch,
      command: 'sleep 10',
      risk: 'read_only',
    });
    await waitForDispatch(actor, pty);
    await expect(executor.interrupt('transaction-interrupt')).resolves.toBe(true);
    expect(pty.interruptCount).toBe(1);
    await expect(execute).resolves.toMatchObject({
      status: 'interrupted',
      transaction: { status: 'interrupted' },
    });
  });

  it('keeps UTF-8 output visible and bounds large tool results', async () => {
    const { pty, actor, leaseEpoch } = await createReadyAgentSession();
    const executor = new CommandExecutor(actor, {
      nonceFactory: () => 'txn-output',
      scheduler: schedulerFor(new FakeClock(0)),
      observationWindowMs: 100,
      outputMaxBytes: 12,
    });

    const execute = executor.execute({
      transactionId: 'transaction-output',
      taskId: 'task-1',
      leaseEpoch,
      command: 'printf output',
      risk: 'read_only',
    });
    await waitForDispatch(actor, pty);
    await startCapture(actor, pty);
    pty.emitData('甲乙丙\n0123456789\n\u001b]777;TA;txn-output;0\u0007');

    await expect(execute).resolves.toMatchObject({
      status: 'completed',
      output: {
        truncated: true,
        totalBytes: expect.any(Number),
        text: expect.stringContaining('[truncated]'),
      },
    });
  });

  it('hands password prompts to the user and requires a fresh probe before resuming', async () => {
    const { pty, actor, leaseEpoch } = await createReadyAgentSession();
    const clock = new FakeClock(0);
    const executor = new CommandExecutor(actor, {
      nonceFactory: () => 'txn-password',
      scheduler: schedulerFor(clock),
      observationWindowMs: 100,
    });

    const execute = executor.execute({
      transactionId: 'transaction-password',
      taskId: 'task-1',
      leaseEpoch,
      command: 'sudo id',
      risk: 'privileged',
    });
    await waitForDispatch(actor, pty);
    await startCapture(actor, pty);
    pty.emitData('Password: ');

    await expect(execute).resolves.toMatchObject({
      status: 'interaction_required',
      transaction: { reason: 'password' },
    });
    expect(actor.snapshot).toMatchObject({
      shell: 'unknown',
      lease: { owner: { kind: 'user' } },
    });

    const newLease = await actor.grantAgentLease('task-2', actor.snapshot.lease.epoch);
    if (!newLease.ok) throw new Error('expected lease after takeover');
    const probe = new ShellProbe(actor, {
      scheduler: schedulerFor(clock),
      timeoutMs: 100,
      nonceFactory: () => 'reprobe',
    });
    const reprobe = probe.run({ taskId: 'task-2', leaseEpoch: newLease.value.lease.epoch });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await Promise.resolve();
      await actor.idle();
      if (pty.writes.some((write) => write.includes('__TA_DIALECT_reprobe__'))) break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    pty.emitData('__TA_DIALECT_reprobe__:/bin/bash:\n');
    await actor.idle();
    const writesBeforeCommand = pty.writes.length;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await Promise.resolve();
      await actor.idle();
      if (pty.writes.length > writesBeforeCommand) break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    pty.emitData('__TA_OS_reprobe__:Linux\r\n');
    pty.emitData('__TA_DONE_reprobe;0__');
    await actor.idle();
    await expect(reprobe).resolves.toMatchObject({ mode: 'structured' });
    probe.dispose();
  });
});
