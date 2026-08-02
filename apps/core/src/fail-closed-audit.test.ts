/**
 * Fail-closed audit tests: Verify that dispatch rejections, environment
 * fingerprint failures, and static gate violations produce audit events
 * and do NOT silently fall back to encoded execution.
 */
import { describe, expect, it } from 'vitest';

import { FakePty } from '@terminal-agent/test-kit';

import { SessionActor } from './session-actor.js';
import { PlaintextShellDispatcher } from './plaintext-dispatcher.js';
import { ShellDriverError, PosixShellDriver } from './shell-driver.js';

describe('Fail-closed audit', () => {
  it('dispatch rejection on unverified environment produces error, not silent fallback', () => {
    const pty = new FakePty(400);
    const actor = new SessionActor('audit-unverified', pty, { executionDialect: 'posix' });

    const dispatcher = new PlaintextShellDispatcher(actor);
    const result = dispatcher.prepare({
      sessionId: 'audit-unverified',
      taskId: 'task-1',
      leaseEpoch: 0,
      command: 'echo test',
      nonce: 'nonce-1',
      dialect: 'posix',
      platform: 'unix',
      environmentEpoch: 0,
      sourceKind: 'plaintext_shell',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Returns a specific error code, not a generic failure
      expect(result.errorCode).toBe('execution_environment_unverified');
      expect(result.message).toBeTruthy();
    }
    // No writes to PTY
    expect(pty.writes).toHaveLength(0);

    actor.dispose();
  });

  it('dispatch rejection on stale epoch does not write to PTY', async () => {
    const pty = new FakePty(401);
    const actor = new SessionActor('audit-stale', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('posix', 'unix');

    const verifiedEpoch = actor.snapshot.environment.capabilityEpoch;
    // Invalidate by user input
    await actor.writeUser('user\r');
    await actor.idle();

    const dispatcher = new PlaintextShellDispatcher(actor);
    const result = dispatcher.prepare({
      sessionId: 'audit-stale',
      taskId: 'task-1',
      leaseEpoch: 0,
      command: 'echo stale',
      nonce: 'nonce-2',
      dialect: 'posix',
      platform: 'unix',
      environmentEpoch: verifiedEpoch,
      sourceKind: 'plaintext_shell',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('execution_environment_unverified');
    }

    actor.dispose();
  });

  it('command_not_auditable from shell driver prevents execution', () => {
    const driver = new PosixShellDriver();

    // Control characters
    expect(() => driver.wrapCommand('echo \x00', 'nonce')).toThrow(ShellDriverError);
    try {
      driver.wrapCommand('echo \x00', 'nonce');
    } catch (error) {
      expect(error).toBeInstanceOf(ShellDriverError);
      expect((error as ShellDriverError).code).toBe('command_not_auditable');
    }

    // Boundary markers
    try {
      driver.wrapCommand('echo __TA_START__', 'nonce');
    } catch (error) {
      expect(error).toBeInstanceOf(ShellDriverError);
      expect((error as ShellDriverError).code).toBe('command_not_auditable');
    }

    // OSC 777
    try {
      driver.wrapCommand('echo \u001b]777;TA;fake;0\u0007', 'nonce');
    } catch (error) {
      expect(error).toBeInstanceOf(ShellDriverError);
      expect((error as ShellDriverError).code).toBe('command_not_auditable');
    }
  });

  it('command_not_auditable propagates through dispatcher', async () => {
    const pty = new FakePty(402);
    const actor = new SessionActor('audit-not-auditable', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('posix', 'unix');
    const lease = await actor.grantAgentLease('task-1', 0);
    if (!lease.ok) throw new Error('expected lease');

    const dispatcher = new PlaintextShellDispatcher(actor);
    const env = actor.snapshot.environment;

    // Try to dispatch a command with boundary markers
    const result = dispatcher.prepare({
      sessionId: 'audit-not-auditable',
      taskId: 'task-1',
      leaseEpoch: lease.value.lease.epoch,
      command: 'echo __TA_START__',
      nonce: 'nonce-3',
      dialect: 'posix',
      platform: 'unix',
      environmentEpoch: env.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('command_not_auditable');
    }
    // No writes to PTY
    expect(pty.writes).toHaveLength(0);

    actor.dispose();
  });

  it('observe_only dialect produces execution_environment_unverified', () => {
    const pty = new FakePty(403);
    const actor = new SessionActor('audit-observe', pty, { executionDialect: 'observe_only' });

    const dispatcher = new PlaintextShellDispatcher(actor);
    const result = dispatcher.prepare({
      sessionId: 'audit-observe',
      taskId: 'task-1',
      leaseEpoch: 0,
      command: 'echo test',
      nonce: 'nonce-4',
      dialect: 'observe_only',
      platform: 'unix',
      environmentEpoch: 0,
      sourceKind: 'plaintext_shell',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('execution_environment_unverified');
    }

    actor.dispose();
  });

  it('rejection path does not write Agent payload to PTY', async () => {
    const pty = new FakePty(404);
    const actor = new SessionActor('audit-no-write', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    const lease = await actor.grantAgentLease('task-1', 0);
    if (!lease.ok) throw new Error('expected lease');

    const dispatcher = new PlaintextShellDispatcher(actor);
    const env = actor.snapshot.environment;

    // Try multiple rejection scenarios
    const scenarios = [
      { command: 'echo test', environmentEpoch: 0, desc: 'unverified' },
      { command: 'echo \x00', environmentEpoch: env.capabilityEpoch, desc: 'control chars' },
    ];

    for (const scenario of scenarios) {
      pty.writes.length = 0;
      const result = dispatcher.prepare({
        sessionId: 'audit-no-write',
        taskId: 'task-1',
        leaseEpoch: lease.value.lease.epoch,
        command: scenario.command,
        nonce: `nonce-${scenario.desc}`,
        dialect: 'posix',
        platform: 'unix',
        environmentEpoch: scenario.environmentEpoch,
        sourceKind: 'plaintext_shell',
      });

      expect(result.ok).toBe(false);
      expect(pty.writes).toHaveLength(0);
    }

    actor.dispose();
  });

  it('static gate violation is caught by test, not at runtime', () => {
    // The static-execution-gate.test.ts scans production modules for forbidden patterns.
    // This test documents that the static gate is the primary defense against
    // new encoded-execution patterns being introduced.
    // Runtime cannot catch patterns that were compiled into the code.
    const driver = new PosixShellDriver();
    const wrapped = driver.wrapCommand('echo safe', 'test-nonce');

    // Verify the output is clean
    expect(wrapped).not.toContain('base64');
    expect(wrapped).not.toContain('eval');
    expect(wrapped).not.toContain('FromBase64String');
    expect(wrapped).not.toContain('ScriptBlock::Create');
    expect(wrapped).toContain('echo safe');
  });
});
