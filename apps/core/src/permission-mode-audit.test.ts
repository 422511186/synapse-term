/**
 * Task 5.4: Verify Permission Mode, Approval Grant, and risk classification
 * use the verified dialect, and command hash is consistent between approval
 * validation and dispatch construction.
 */
import { describe, expect, it } from 'vitest';

import { FakePty } from '@terminal-agent/test-kit';

import { hashCommand } from './approval-manager.js';
import { PlaintextShellDispatcher } from './plaintext-dispatcher.js';
import { SessionActor } from './session-actor.js';

describe('Permission Mode & Approval chain', () => {
  it('command hash from dispatcher matches hashCommand utility', async () => {
    const pty = new FakePty(500);
    const actor = new SessionActor('perm-hash', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('posix', 'unix');
    const lease = await actor.grantAgentLease('task-1', 0);
    if (!lease.ok) throw new Error('expected lease');

    const command = 'curl -X POST https://api.example.com';
    const expectedHash = hashCommand(command);

    const dispatcher = new PlaintextShellDispatcher(actor);
    const result = dispatcher.prepare({
      sessionId: 'perm-hash',
      taskId: 'task-1',
      leaseEpoch: lease.value.lease.epoch,
      command,
      nonce: 'nonce-hash',
      dialect: 'posix',
      platform: 'unix',
      environmentEpoch: actor.snapshot.environment.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Dispatcher hash matches approval hash
      expect(result.commandHash).toBe(expectedHash);
    }

    actor.dispose();
  });

  it('different commands produce different hashes', () => {
    expect(hashCommand('echo a')).not.toBe(hashCommand('echo b'));
    expect(hashCommand('ls')).not.toBe(hashCommand('ls -la'));
    expect(hashCommand('echo "hello"')).not.toBe(hashCommand('echo "world"'));
  });

  it('same command always produces same hash', () => {
    const command = 'git status';
    const hash1 = hashCommand(command);
    const hash2 = hashCommand(command);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('dialect from verified environment is used, not stale hint', async () => {
    const pty = new FakePty(501);
    const actor = new SessionActor('perm-dialect', pty, { executionDialect: 'powershell' });
    await actor.markPtyRunning();

    // Switch dialect (simulating SSH hop)
    await actor.setExecutionDialect('posix');
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('posix', 'unix');

    // The verified dialect should be posix, not the original powershell
    expect(actor.snapshot.environment.dialect).toBe('posix');
    expect(actor.snapshot.executionDialect).toBe('posix');

    const lease = await actor.grantAgentLease('task-1', 0);
    if (!lease.ok) throw new Error('expected lease');

    const dispatcher = new PlaintextShellDispatcher(actor);
    const result = dispatcher.prepare({
      sessionId: 'perm-dialect',
      taskId: 'task-1',
      leaseEpoch: lease.value.lease.epoch,
      command: 'echo dialect-check',
      nonce: 'nonce-dialect',
      dialect: 'posix', // verified dialect
      platform: 'unix',
      environmentEpoch: actor.snapshot.environment.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dialect).toBe('posix');
      // Uses POSIX brace group, not PowerShell
      expect(result.wrappedCommand).toContain('{');
      expect(result.wrappedCommand).toContain('}');
      expect(result.wrappedCommand).not.toContain('. {');
    }

    actor.dispose();
  });

  it('observation_only environment rejects before approval check', async () => {
    const pty = new FakePty(502);
    const actor = new SessionActor('perm-observe', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    await actor.setExecutionDialect('observe_only');

    const dispatcher = new PlaintextShellDispatcher(actor);
    const result = dispatcher.prepare({
      sessionId: 'perm-observe',
      taskId: 'task-1',
      leaseEpoch: 0,
      command: 'echo test',
      nonce: 'nonce-observe',
      dialect: 'observe_only',
      platform: 'unix',
      environmentEpoch: 0,
      sourceKind: 'plaintext_shell',
    });

    // Rejected before any approval validation
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('execution_environment_unverified');
    }

    actor.dispose();
  });

  it('user takeover invalidates environment before next dispatch', async () => {
    const pty = new FakePty(503);
    const actor = new SessionActor('perm-takeover', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('posix', 'unix');
    const lease = await actor.grantAgentLease('task-1', 0);
    if (!lease.ok) throw new Error('expected lease');
    const env = actor.snapshot.environment;

    // First dispatch succeeds
    const dispatcher = new PlaintextShellDispatcher(actor);
    const result1 = dispatcher.prepare({
      sessionId: 'perm-takeover',
      taskId: 'task-1',
      leaseEpoch: lease.value.lease.epoch,
      command: 'echo first',
      nonce: 'nonce-first',
      dialect: env.dialect as 'posix',
      platform: env.platform,
      environmentEpoch: env.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });
    expect(result1.ok).toBe(true);

    // User takes over
    await actor.writeUser('user input\r');
    await actor.idle();

    // Same epoch no longer valid
    const result2 = dispatcher.prepare({
      sessionId: 'perm-takeover',
      taskId: 'task-1',
      leaseEpoch: actor.snapshot.lease.epoch,
      command: 'echo second',
      nonce: 'nonce-second',
      dialect: 'posix',
      platform: 'unix',
      environmentEpoch: env.capabilityEpoch, // stale
      sourceKind: 'plaintext_shell',
    });
    expect(result2.ok).toBe(false);

    actor.dispose();
  });
});
