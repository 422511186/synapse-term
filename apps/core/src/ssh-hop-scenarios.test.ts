/**
 * Task 6.1: Fake PTY integration tests for SSH hop scenarios.
 */
import { describe, expect, it } from 'vitest';

import { FakePty } from '@terminal-agent/test-kit';

import { SessionActor } from './session-actor.js';
import { PlaintextShellDispatcher } from './plaintext-dispatcher.js';

describe('SSH hop scenarios', () => {
  it('PowerShell SSH into Linux: dialect switch and re-verify', async () => {
    const pty = new FakePty(600);
    const actor = new SessionActor('ssh-ps-to-posix', pty, { executionDialect: 'powershell' });
    await actor.markPtyRunning();
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('powershell', 'windows');
    expect(actor.snapshot.environment.dialect).toBe('powershell');

    // User SSH into Linux
    await actor.writeUser('ssh user@linux\r');
    await actor.idle();
    expect(actor.snapshot.environment.verificationStatus).toBe('unverified');

    // Switch dialect
    await actor.setExecutionDialect('posix');
    expect(actor.snapshot.environment.dialect).toBe('posix');

    // Re-verify
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('posix', 'unix');
    expect(actor.snapshot.environment.verificationStatus).toBe('verified');

    // Dispatch uses POSIX
    const lease = await actor.grantAgentLease('task-1', actor.snapshot.lease.epoch);
    if (!lease.ok) throw new Error('expected lease');

    const dispatcher = new PlaintextShellDispatcher(actor);
    const result = dispatcher.prepare({
      sessionId: 'ssh-ps-to-posix',
      taskId: 'task-1',
      leaseEpoch: lease.value.lease.epoch,
      command: 'uname -a',
      nonce: 'nonce-uname',
      dialect: 'posix',
      platform: 'unix',
      environmentEpoch: actor.snapshot.environment.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.wrappedCommand).toContain('{');
      expect(result.wrappedCommand).toContain('uname -a');
      expect(result.wrappedCommand).not.toContain('[Console]');
    }

    actor.dispose();
  });

  it('POSIX SSH into Windows PowerShell: dialect switch', async () => {
    const pty = new FakePty(601);
    const actor = new SessionActor('ssh-posix-to-ps', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('posix', 'unix');

    await actor.writeUser('ssh user@windows\r');
    await actor.idle();

    await actor.setExecutionDialect('powershell');
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('powershell', 'windows');

    const lease = await actor.grantAgentLease('task-1', actor.snapshot.lease.epoch);
    if (!lease.ok) throw new Error('expected lease');

    const dispatcher = new PlaintextShellDispatcher(actor);
    const result = dispatcher.prepare({
      sessionId: 'ssh-posix-to-ps',
      taskId: 'task-1',
      leaseEpoch: lease.value.lease.epoch,
      command: 'Get-Process',
      nonce: 'nonce-ps',
      dialect: 'powershell',
      platform: 'windows',
      environmentEpoch: actor.snapshot.environment.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.wrappedCommand).toContain('. {');
      expect(result.wrappedCommand).toContain('Get-Process');
      expect(result.wrappedCommand).not.toContain('__ta_exit=$?');
    }

    actor.dispose();
  });

  it('container entry: environment remains POSIX/Unix', async () => {
    const pty = new FakePty(602);
    const actor = new SessionActor('container', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('posix', 'unix');

    await actor.writeUser('docker exec -it c bash\r');
    await actor.idle();
    expect(actor.snapshot.environment.verificationStatus).toBe('unverified');

    // Re-verify as POSIX
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('posix', 'unix');
    expect(actor.snapshot.environment.dialect).toBe('posix');
    expect(actor.snapshot.environment.platform).toBe('unix');

    actor.dispose();
  });

  it('user takeover during SSH: dispatch rejected until re-verify', async () => {
    const pty = new FakePty(603);
    const actor = new SessionActor('ssh-takeover', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('posix', 'unix');
    const lease = await actor.grantAgentLease('task-1', 0);
    if (!lease.ok) throw new Error('expected lease');
    const env = actor.snapshot.environment;

    // User takes over
    await actor.writeUser('manual commands\r');
    await actor.idle();

    // Old epoch rejected
    const dispatcher = new PlaintextShellDispatcher(actor);
    const rejected = dispatcher.prepare({
      sessionId: 'ssh-takeover',
      taskId: 'task-1',
      leaseEpoch: actor.snapshot.lease.epoch,
      command: 'echo test',
      nonce: 'nonce-takeover',
      dialect: 'posix',
      platform: 'unix',
      environmentEpoch: env.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });
    expect(rejected.ok).toBe(false);

    // Re-verify
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('posix', 'unix');

    const newLease = await actor.grantAgentLease('task-2', actor.snapshot.lease.epoch);
    if (!newLease.ok) throw new Error('expected new lease');

    const approved = dispatcher.prepare({
      sessionId: 'ssh-takeover',
      taskId: 'task-2',
      leaseEpoch: newLease.value.lease.epoch,
      command: 'echo reverified',
      nonce: 'nonce-reverified',
      dialect: 'posix',
      platform: 'unix',
      environmentEpoch: actor.snapshot.environment.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });
    expect(approved.ok).toBe(true);

    actor.dispose();
  });

  it('bastion hop: no wrong-dialect wrapper written', async () => {
    const pty = new FakePty(604);
    const actor = new SessionActor('bastion', pty, { executionDialect: 'powershell' });
    await actor.markPtyRunning();
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('powershell', 'windows');

    // Hop through bastion to Linux
    await actor.writeUser('ssh bastion\r');
    await actor.idle();
    await actor.writeUser('ssh target-linux\r');
    await actor.idle();

    await actor.setExecutionDialect('posix');
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('posix', 'unix');

    const lease = await actor.grantAgentLease('task-1', actor.snapshot.lease.epoch);
    if (!lease.ok) throw new Error('expected lease');

    const dispatcher = new PlaintextShellDispatcher(actor);
    const result = dispatcher.prepare({
      sessionId: 'bastion',
      taskId: 'task-1',
      leaseEpoch: lease.value.lease.epoch,
      command: 'whoami',
      nonce: 'nonce-bastion',
      dialect: 'posix',
      platform: 'unix',
      environmentEpoch: actor.snapshot.environment.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.wrappedCommand).toContain('{');
      expect(result.wrappedCommand).not.toContain('[Console]');
      expect(result.wrappedCommand).not.toContain('FromBase64String');
    }

    actor.dispose();
  });

  it('concurrent user input invalidates pending dispatch epoch', async () => {
    const pty = new FakePty(605);
    const actor = new SessionActor('concurrent', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('posix', 'unix');
    const lease = await actor.grantAgentLease('task-1', 0);
    if (!lease.ok) throw new Error('expected lease');
    const env = actor.snapshot.environment;

    const dispatcher = new PlaintextShellDispatcher(actor);
    const result1 = dispatcher.prepare({
      sessionId: 'concurrent',
      taskId: 'task-1',
      leaseEpoch: lease.value.lease.epoch,
      command: 'echo first',
      nonce: 'nonce-first',
      dialect: 'posix',
      platform: 'unix',
      environmentEpoch: env.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });
    expect(result1.ok).toBe(true);

    // User interruption
    await actor.writeUser('interruption\r');
    await actor.idle();

    // Old epoch fails
    const result2 = dispatcher.prepare({
      sessionId: 'concurrent',
      taskId: 'task-1',
      leaseEpoch: actor.snapshot.lease.epoch,
      command: 'echo second',
      nonce: 'nonce-second',
      dialect: 'posix',
      platform: 'unix',
      environmentEpoch: env.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });
    expect(result2.ok).toBe(false);

    actor.dispose();
  });
});
