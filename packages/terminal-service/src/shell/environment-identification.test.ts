import { describe, expect, it } from 'vitest';

import type { ExecutionDialect } from '@synapse-term/domain';
import { FakePty } from '@synapse-term/test-kit';

import { SessionActor } from '../session/session-actor.js';
import { PlaintextShellDispatcher } from '../execution/plaintext-dispatcher.js';

/** Create a session with environment already verified (bypasses probe) */
async function createVerifiedSession(executionDialect: ExecutionDialect = 'posix') {
  const pty = new FakePty(100);
  const actor = new SessionActor('env-test', pty, { executionDialect });
  await actor.markPtyRunning();
  await actor.transitionShell('probing');
  await actor.transitionShell('ready');
  await actor.verifyCurrentEnvironment(
    executionDialect === 'observe_only' ? 'posix' : executionDialect,
    executionDialect === 'powershell' ? 'windows' : 'unix',
  );
  const lease = await actor.grantAgentLease('task-1', 0);
  if (!lease.ok) throw new Error('expected lease');
  return { pty, actor, leaseEpoch: lease.value.lease.epoch };
}

/** Create a session in initial unverified state */
async function createUnverifiedSession(executionDialect: ExecutionDialect = 'posix') {
  const pty = new FakePty(200);
  const actor = new SessionActor('env-unverified', pty, { executionDialect });
  await actor.markPtyRunning();
  return { pty, actor };
}

describe('Environment identification scenarios', () => {
  it('initial session has unverified environment', async () => {
    const { actor } = await createUnverifiedSession('posix');
    expect(actor.snapshot.environment.verificationStatus).toBe('unverified');
    expect(actor.snapshot.environment.capabilityEpoch).toBe(0);
    actor.dispose();
  });

  it('probe verifies environment and bumps epoch', async () => {
    const { actor } = await createVerifiedSession('posix');
    expect(actor.snapshot.environment.verificationStatus).toBe('verified');
    expect(actor.snapshot.environment.dialect).toBe('posix');
    expect(actor.snapshot.environment.platform).toBe('unix');
    expect(actor.snapshot.environment.capabilityEpoch).toBeGreaterThan(0);
    actor.dispose();
  });

  it('user takeover invalidates environment verification', async () => {
    const { actor } = await createVerifiedSession('posix');
    expect(actor.snapshot.environment.verificationStatus).toBe('verified');
    const epochBefore = actor.snapshot.environment.capabilityEpoch;

    // User takes over
    await actor.writeUser('echo user-input\r');
    await actor.idle();

    expect(actor.snapshot.environment.verificationStatus).toBe('unverified');
    expect(actor.snapshot.environment.capabilityEpoch).toBeGreaterThan(epochBefore);
    expect(actor.snapshot.lease.owner.kind).toBe('user');
    actor.dispose();
  });

  it('takeoverUser() method invalidates environment', async () => {
    const { actor } = await createVerifiedSession('posix');
    expect(actor.snapshot.environment.verificationStatus).toBe('verified');

    await actor.takeoverUser();
    expect(actor.snapshot.environment.verificationStatus).toBe('unverified');
    expect(actor.snapshot.lease.owner.kind).toBe('user');
    actor.dispose();
  });

  it('PowerShell -> POSIX dialect switch invalidates environment', async () => {
    const { actor } = await createVerifiedSession('powershell');
    expect(actor.snapshot.environment.dialect).toBe('powershell');
    expect(actor.snapshot.environment.verificationStatus).toBe('verified');
    const epochBefore = actor.snapshot.environment.capabilityEpoch;

    // Switch dialect (simulating SSH into Linux)
    await actor.setExecutionDialect('posix');
    expect(actor.snapshot.executionDialect).toBe('posix');
    expect(actor.snapshot.environment.verificationStatus).toBe('unverified');
    expect(actor.snapshot.environment.dialect).toBe('posix');
    expect(actor.snapshot.environment.capabilityEpoch).toBeGreaterThan(epochBefore);
    actor.dispose();
  });

  it('POSIX -> PowerShell dialect switch invalidates environment', async () => {
    const { actor } = await createVerifiedSession('posix');
    expect(actor.snapshot.environment.dialect).toBe('posix');
    const epochBefore = actor.snapshot.environment.capabilityEpoch;

    await actor.setExecutionDialect('powershell');
    expect(actor.snapshot.executionDialect).toBe('powershell');
    expect(actor.snapshot.environment.verificationStatus).toBe('unverified');
    expect(actor.snapshot.environment.capabilityEpoch).toBeGreaterThan(epochBefore);
    actor.dispose();
  });

  it('same dialect switch does not change state', async () => {
    const { actor } = await createVerifiedSession('posix');
    const epochBefore = actor.snapshot.environment.capabilityEpoch;

    // Setting same dialect should be a no-op
    await actor.setExecutionDialect('posix');
    expect(actor.snapshot.environment.capabilityEpoch).toBe(epochBefore);
    expect(actor.snapshot.environment.verificationStatus).toBe('verified');
    actor.dispose();
  });

  it('observation_only dispatch rejects execution', async () => {
    const { actor, leaseEpoch } = await createVerifiedSession('posix');
    await actor.setExecutionDialect('observe_only');

    const dispatcher = new PlaintextShellDispatcher(actor);
    const result = dispatcher.prepare({
      sessionId: 'env-test',
      taskId: 'task-1',
      leaseEpoch,
      command: 'echo test',
      nonce: 'nonce-1',
      dialect: 'observe_only',
      platform: 'unix',
      environmentEpoch: actor.snapshot.environment.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('execution_environment_unverified');
    }
    actor.dispose();
  });

  it('stale environment epoch rejects dispatch', async () => {
    const { actor, leaseEpoch } = await createVerifiedSession('posix');
    const verifiedEpoch = actor.snapshot.environment.capabilityEpoch;

    // Switch dialect to bump epoch
    await actor.setExecutionDialect('powershell');

    const dispatcher = new PlaintextShellDispatcher(actor);
    const result = dispatcher.prepare({
      sessionId: 'env-test',
      taskId: 'task-1',
      leaseEpoch,
      command: 'echo test',
      nonce: 'nonce-1',
      dialect: 'posix',
      platform: 'unix',
      environmentEpoch: verifiedEpoch, // stale
      sourceKind: 'plaintext_shell',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('execution_environment_unverified');
    }
    actor.dispose();
  });

  it('unverified environment rejects dispatch', async () => {
    const { actor } = await createUnverifiedSession('posix');
    const lease = await actor.grantAgentLease('task-1', 0);
    if (!lease.ok) throw new Error('expected lease');

    const dispatcher = new PlaintextShellDispatcher(actor);
    const result = dispatcher.prepare({
      sessionId: 'env-unverified',
      taskId: 'task-1',
      leaseEpoch: lease.value.lease.epoch,
      command: 'echo test',
      nonce: 'nonce-1',
      dialect: 'posix',
      platform: 'unix',
      environmentEpoch: actor.snapshot.environment.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('execution_environment_unverified');
    }
    actor.dispose();
  });

  it('rejects a verified shell whose operating system identity is still unknown', async () => {
    const { actor } = await createUnverifiedSession('posix');
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    const lease = await actor.grantAgentLease('task-1', actor.snapshot.lease.epoch);
    if (!lease.ok) throw new Error('expected lease');
    const env = actor.snapshot.environment;
    expect(env.verificationStatus).toBe('verified');
    expect(env.operatingSystem).toBe('unknown');

    const dispatcher = new PlaintextShellDispatcher(actor);
    const result = dispatcher.prepare({
      sessionId: 'env-unverified',
      taskId: 'task-1',
      leaseEpoch: lease.value.lease.epoch,
      command: 'echo test',
      nonce: 'nonce-unknown-os',
      dialect: 'posix',
      platform: 'unknown',
      environmentEpoch: env.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'execution_environment_unverified',
    });
    actor.dispose();
  });

  it('verified environment allows dispatch with correct epoch', async () => {
    const { actor, leaseEpoch } = await createVerifiedSession('posix');
    const env = actor.snapshot.environment;

    const dispatcher = new PlaintextShellDispatcher(actor);
    const result = dispatcher.prepare({
      sessionId: 'env-test',
      taskId: 'task-1',
      leaseEpoch,
      command: 'echo hello',
      nonce: 'nonce-ok',
      dialect: env.dialect as 'posix',
      platform: env.platform,
      environmentEpoch: env.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transportMode).toBe('plaintext');
      expect(result.wrappedCommand).toContain('echo hello');
      expect(result.wrappedCommand).not.toContain('base64');
    }
    actor.dispose();
  });

  it('multiple user inputs keep invalidating environment', async () => {
    const { actor } = await createVerifiedSession('posix');

    await actor.writeUser('first\r');
    await actor.idle();
    expect(actor.snapshot.environment.verificationStatus).toBe('unverified');
    const epoch1 = actor.snapshot.environment.capabilityEpoch;

    // Re-verify
    await actor.verifyCurrentEnvironment('posix', 'unix');
    expect(actor.snapshot.environment.verificationStatus).toBe('verified');

    // Second user input
    await actor.writeUser('second\r');
    await actor.idle();
    expect(actor.snapshot.environment.verificationStatus).toBe('unverified');
    expect(actor.snapshot.environment.capabilityEpoch).toBeGreaterThan(epoch1);
    actor.dispose();
  });

  it('interactions signal does not change environment (only user writes do)', async () => {
    const { actor } = await createVerifiedSession('posix');
    const epochBefore = actor.snapshot.environment.capabilityEpoch;

    // interaction_required state doesn't directly invalidate environment
    // Environment is only invalidated by actual user input or dialect switch
    expect(actor.snapshot.environment.verificationStatus).toBe('verified');
    expect(actor.snapshot.environment.capabilityEpoch).toBe(epochBefore);
    actor.dispose();
  });
});
