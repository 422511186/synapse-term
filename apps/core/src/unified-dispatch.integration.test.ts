/**
 * Integration test: Proves that terminal_execute and all Agent PTY operations
 * go through PlaintextShellDispatcher, and that unverified environments reject execution.
 */
import { describe, expect, it } from 'vitest';

import { FakePty } from '@terminal-agent/test-kit';

import { SessionActor } from './session-actor.js';
import { PlaintextShellDispatcher } from './plaintext-dispatcher.js';
import { CommandExecutor } from './command-executor.js';

async function createReadySession(dialect: 'posix' | 'powershell' = 'posix') {
  const pty = new FakePty(300);
  const actor = new SessionActor('dispatch-test', pty, { executionDialect: dialect });
  await actor.markPtyRunning();
  await actor.transitionShell('probing');
  await actor.transitionShell('ready');
  await actor.verifyCurrentEnvironment(dialect, dialect === 'powershell' ? 'windows' : 'unix');
  const lease = await actor.grantAgentLease('task-1', 0);
  if (!lease.ok) throw new Error('expected lease');
  return { pty, actor, leaseEpoch: lease.value.lease.epoch };
}

function allWritesJoined(pty: FakePty): string {
  return pty.writes.join('\n');
}

async function waitForFullDispatch(actor: SessionActor, pty: FakePty): Promise<void> {
  for (let i = 0; i < 200; i++) {
    await Promise.resolve();
    await actor.idle();
    const joined = pty.writes.join('\n');
    if (joined.includes('unset __ta_exit') || joined.includes('Remove-Variable __ta_exit')) return;
    await new Promise<void>((r) => setImmediate(r));
  }
  throw new Error(`dispatch did not complete. Writes:\n${pty.writes.join('\n---\n')}`);
}

describe('Unified Agent PTY Dispatch', () => {
  it('terminal_execute dispatches via plaintext brace group (POSIX)', async () => {
    const { pty, actor, leaseEpoch } = await createReadySession('posix');

    const executor = new CommandExecutor(actor, {
      nonceFactory: () => 'dispatch-cmd',
      observationWindowMs: 100,
    });

    const execution = executor.execute({
      taskId: 'task-1',
      leaseEpoch,
      command: 'echo unified',
      risk: 'read_only',
    });

    await waitForFullDispatch(actor, pty);

    const dispatched = allWritesJoined(pty);
    expect(dispatched).toContain('__TA_');
    expect(dispatched).toContain('START__');
    expect(dispatched).toContain('echo unified');
    expect(dispatched).toContain('{');
    expect(dispatched).toContain('}');
    expect(dispatched).toContain('__ta_exit=$?');
    expect(dispatched).not.toContain('base64');
    expect(dispatched).not.toContain('eval');
    expect(dispatched).not.toContain('FromBase64String');

    pty.emitData('ok\u001b]777;TA;dispatch-cmd;0\u0007');
    pty.emitData('__TA_DONE_dispatch-cmd;0__\n');
    await expect(execution).resolves.toMatchObject({
      status: 'completed',
      transaction: { exitCode: 0 },
    });

    actor.dispose();
  });

  it('unverified environment rejects dispatch (no PTY write)', async () => {
    const pty = new FakePty(301);
    const actor = new SessionActor('unverified', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    const lease = await actor.grantAgentLease('task-x', 0);
    if (!lease.ok) throw new Error('expected lease');

    const dispatcher = new PlaintextShellDispatcher(actor);
    const rejected = dispatcher.prepare({
      sessionId: 'unverified',
      taskId: 'task-x',
      leaseEpoch: lease.value.lease.epoch,
      command: 'echo bypass',
      nonce: 'bypass-nonce',
      dialect: 'posix',
      platform: 'unix',
      environmentEpoch: actor.snapshot.environment.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.errorCode).toBe('execution_environment_unverified');
    }
    expect(pty.writes).toHaveLength(0);

    actor.dispose();
  });

  it('PowerShell dispatch uses dot-sourced block', async () => {
    const { pty, actor, leaseEpoch } = await createReadySession('powershell');

    const executor = new CommandExecutor(actor, {
      nonceFactory: () => 'ps-dispatch',
      observationWindowMs: 100,
    });

    const execution = executor.execute({
      taskId: 'task-1',
      leaseEpoch,
      command: 'Get-Location',
      risk: 'read_only',
    });

    await waitForFullDispatch(actor, pty);

    const dispatched = allWritesJoined(pty);
    expect(dispatched).toContain('. {');
    expect(dispatched).toContain('Get-Location');
    expect(dispatched).toContain('__TA_');
    expect(dispatched).toContain('START__');
    expect(dispatched).not.toContain('FromBase64String');
    expect(dispatched).not.toContain('[ScriptBlock]::Create');
    expect(dispatched).not.toContain('base64');

    pty.emitData('C:\\work\u001b]777;TA;ps-dispatch;0\u0007');
    pty.emitData('__TA_DONE_ps-dispatch;0__\n');
    await expect(execution).resolves.toMatchObject({
      status: 'completed',
      transaction: { exitCode: 0 },
    });

    actor.dispose();
  });

  it('all dispatch paths preserve original command in plaintext', async () => {
    const { pty, actor, leaseEpoch } = await createReadySession('posix');

    const testCommands = ['echo simple', 'ls -la /tmp', 'cat /etc/hostname'];

    for (const command of testCommands) {
      pty.writes.length = 0;
      const nonce = `nonce-${command.replace(/\s/g, '-')}`;
      const executor = new CommandExecutor(actor, {
        nonceFactory: () => nonce,
        observationWindowMs: 100,
      });

      const execution = executor.execute({
        taskId: 'task-1',
        leaseEpoch,
        command,
        risk: 'read_only',
      });

      await waitForFullDispatch(actor, pty);

      const dispatched = allWritesJoined(pty);
      expect(dispatched).toContain(command);
      expect(dispatched).not.toContain('base64');

      pty.emitData(`ok\u001b]777;TA;${nonce};0\u0007`);
      pty.emitData(`__TA_DONE_${nonce};0__\n`);
      await expect(execution).resolves.toMatchObject({ status: 'completed' });
    }

    actor.dispose();
  });

  it('command hash is deterministic across dispatches', async () => {
    const { actor, leaseEpoch } = await createReadySession('posix');
    const env = actor.snapshot.environment;

    const dispatcher = new PlaintextShellDispatcher(actor);

    const result1 = dispatcher.prepare({
      sessionId: 'dispatch-test',
      taskId: 'task-1',
      leaseEpoch,
      command: 'echo hash-test',
      nonce: 'nonce-a',
      dialect: env.dialect as 'posix',
      platform: env.platform,
      environmentEpoch: env.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });

    const result2 = dispatcher.prepare({
      sessionId: 'dispatch-test',
      taskId: 'task-1',
      leaseEpoch,
      command: 'echo hash-test',
      nonce: 'nonce-b',
      dialect: env.dialect as 'posix',
      platform: env.platform,
      environmentEpoch: env.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (result1.ok && result2.ok) {
      expect(result1.commandHash).toBe(result2.commandHash);
      expect(result1.wrappedCommand).not.toBe(result2.wrappedCommand);
    }

    actor.dispose();
  });

  it('stale epoch rejects dispatch even when environment was previously verified', async () => {
    const { pty, actor } = await createReadySession('posix');
    const verifiedEpoch = actor.snapshot.environment.capabilityEpoch;

    // Simulate user takeover which invalidates epoch
    await actor.writeUser('user input\r');
    await actor.idle();
    const writesBeforeDispatch = pty.writes.length;

    const dispatcher = new PlaintextShellDispatcher(actor);
    const rejected = dispatcher.prepare({
      sessionId: 'dispatch-test',
      taskId: 'task-1',
      leaseEpoch: actor.snapshot.lease.epoch,
      command: 'echo stale',
      nonce: 'stale-nonce',
      dialect: 'posix',
      platform: 'unix',
      environmentEpoch: verifiedEpoch, // old epoch
      sourceKind: 'plaintext_shell',
    });

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.errorCode).toBe('execution_environment_unverified');
    }
    expect(pty.writes).toHaveLength(writesBeforeDispatch);

    actor.dispose();
  });
});
