/**
 * Task 6.4: Core/ToolGateway flow coverage for plaintext dispatch.
 */
import { describe, expect, it } from 'vitest';

import { FakePty } from '@terminal-agent/test-kit';

import { SessionActor } from './session-actor.js';
import { PlaintextShellDispatcher } from './plaintext-dispatcher.js';

describe('Core/ToolGateway flow coverage', () => {
  it('first execution rejects when environment unverified', async () => {
    const pty = new FakePty(700);
    const actor = new SessionActor('flow-first', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    const lease = await actor.grantAgentLease('task-1', 0);
    if (!lease.ok) throw new Error('expected lease');

    const dispatcher = new PlaintextShellDispatcher(actor);
    const result = dispatcher.prepare({
      sessionId: 'flow-first',
      taskId: 'task-1',
      leaseEpoch: lease.value.lease.epoch,
      command: 'echo first',
      nonce: 'n',
      dialect: 'posix',
      platform: 'unix',
      environmentEpoch: actor.snapshot.environment.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });

    expect(result.ok).toBe(false);
    expect(pty.writes).toHaveLength(0);
    actor.dispose();
  });

  it('epoch invalidation after user input prevents stale dispatch', async () => {
    const pty = new FakePty(701);
    const actor = new SessionActor('flow-epoch', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('posix', 'unix');
    const lease = await actor.grantAgentLease('task-1', 0);
    if (!lease.ok) throw new Error('expected lease');
    const env = actor.snapshot.environment;

    await actor.writeUser('user\r');
    await actor.idle();
    const writesBeforeDispatch = pty.writes.length;

    const dispatcher = new PlaintextShellDispatcher(actor);
    const result = dispatcher.prepare({
      sessionId: 'flow-epoch',
      taskId: 'task-1',
      leaseEpoch: actor.snapshot.lease.epoch,
      command: 'echo stale',
      nonce: 'n',
      dialect: 'posix',
      platform: 'unix',
      environmentEpoch: env.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });

    expect(result.ok).toBe(false);
    // No new writes from dispatch
    expect(pty.writes.length).toBe(writesBeforeDispatch);
    actor.dispose();
  });

  it('dispatch produces attestation fields', async () => {
    const pty = new FakePty(702);
    const actor = new SessionActor('flow-att', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('posix', 'unix');
    const lease = await actor.grantAgentLease('task-1', 0);
    if (!lease.ok) throw new Error('expected lease');
    const env = actor.snapshot.environment;

    const dispatcher = new PlaintextShellDispatcher(actor);
    const result = dispatcher.prepare({
      sessionId: 'flow-att',
      taskId: 'task-1',
      leaseEpoch: lease.value.lease.epoch,
      command: 'echo att',
      nonce: 'n',
      dialect: 'posix',
      platform: 'unix',
      environmentEpoch: env.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transportMode).toBe('plaintext');
      expect(result.commandHash).toMatch(/^sha256:/);
      expect(result.dialect).toBe('posix');
      expect(result.platform).toBe('unix');
      expect(result.environmentEpoch).toBe(env.capabilityEpoch);
    }
    actor.dispose();
  });

  it('command_not_auditable prevents execution', async () => {
    const pty = new FakePty(703);
    const actor = new SessionActor('flow-na', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.verifyCurrentEnvironment('posix', 'unix');
    const lease = await actor.grantAgentLease('task-1', 0);
    if (!lease.ok) throw new Error('expected lease');

    const dispatcher = new PlaintextShellDispatcher(actor);
    const result = dispatcher.prepare({
      sessionId: 'flow-na',
      taskId: 'task-1',
      leaseEpoch: lease.value.lease.epoch,
      command: 'echo \x00',
      nonce: 'n',
      dialect: 'posix',
      platform: 'unix',
      environmentEpoch: actor.snapshot.environment.capabilityEpoch,
      sourceKind: 'plaintext_shell',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('command_not_auditable');
    expect(pty.writes).toHaveLength(0);
    actor.dispose();
  });

  it('observe_only rejects all dispatch attempts', () => {
    const pty = new FakePty(704);
    const actor = new SessionActor('flow-observe', pty, { executionDialect: 'observe_only' });

    const dispatcher = new PlaintextShellDispatcher(actor);
    const result = dispatcher.prepare({
      sessionId: 'flow-observe',
      taskId: 'task-1',
      leaseEpoch: 0,
      command: 'echo test',
      nonce: 'n',
      dialect: 'observe_only',
      platform: 'unknown',
      environmentEpoch: 0,
      sourceKind: 'plaintext_shell',
    });

    expect(result.ok).toBe(false);
    actor.dispose();
  });

  it('multiple rejections produce zero PTY writes', () => {
    const pty = new FakePty(705);
    const actor = new SessionActor('flow-multi', pty, { executionDialect: 'posix' });

    const dispatcher = new PlaintextShellDispatcher(actor);
    for (const cmd of ['echo test', 'echo \x00', 'echo __TA_START__']) {
      const r = dispatcher.prepare({
        sessionId: 'flow-multi',
        taskId: 'task-1',
        leaseEpoch: 0,
        command: cmd,
        nonce: 'n',
        dialect: 'posix',
        platform: 'unix',
        environmentEpoch: 0,
        sourceKind: 'plaintext_shell',
      });
      expect(r.ok).toBe(false);
    }
    expect(pty.writes).toHaveLength(0);
    actor.dispose();
  });
});
