import { describe, expect, it } from 'vitest';

import {
  createSessionState,
  createExecutionEnvironment,
  verifyEnvironment,
  invalidateEnvironment,
  grantAgentLease,
  grantExternalLease,
  invalidateShellCapability,
  releaseAgentLease,
  releaseExternalLease,
  returnAgentLeaseToUser,
  setSessionExecutionDialect,
  setSessionAttachment,
  takeUserLease,
  transitionSessionPty,
  transitionSessionShell,
} from './session-state.js';

describe('session state', () => {
  it('defaults to observation-only execution and invalidates capability when dialect changes', () => {
    const session = createSessionState('session-1');
    expect(session.executionDialect).toBe('observe_only');
    expect(session.environment.dialect).toBe('observe_only');
    expect(session.environment.verificationStatus).toBe('unverified');

    const changed = setSessionExecutionDialect(session, 'powershell');
    expect(changed).toMatchObject({
      executionDialect: 'powershell',
      shell: 'unknown',
      shellCapabilityEpoch: 1,
    });
    expect(changed.environment.dialect).toBe('powershell');
    expect(changed.environment.verificationStatus).toBe('unverified');
  });

  it('starts detached with a user-owned lease and unverified environment', () => {
    const session = createSessionState('session-1');

    expect(session).toMatchObject({
      id: 'session-1',
      pty: 'starting',
      attachment: 'detached',
      shell: 'unknown',
      lease: { owner: { kind: 'user' }, epoch: 0 },
    });
    expect(session.sharedAt).toBeUndefined();
    expect(session.environment).toMatchObject({
      dialect: 'observe_only',
      platform: 'unknown',
      operatingSystem: 'unknown',
      verificationStatus: 'unverified',
      capabilityEpoch: 0,
    });
  });

  it('creates a session with environment hint from startup dialect', () => {
    const session = createSessionState('session-2', 'posix');
    expect(session.environment.dialect).toBe('posix');
    expect(session.environment.verificationStatus).toBe('unverified');
    expect(session.environment.source).toBe('manual_hint');
  });

  it('invalidates stale lease epochs when control changes', () => {
    const initial = createSessionState('session-1');
    const agentLease = grantAgentLease(initial, 'task-1', 0);

    expect(agentLease).toMatchObject({
      ok: true,
      value: { lease: { owner: { kind: 'agent', taskId: 'task-1' }, epoch: 1 } },
    });
    if (!agentLease.ok) throw new Error('expected an agent lease');

    const userLease = takeUserLease(agentLease.value);
    expect(userLease.lease).toEqual({ owner: { kind: 'user' }, epoch: 2 });
    expect(grantAgentLease(userLease, 'task-1', 1)).toEqual({
      ok: false,
      error: 'stale-lease-epoch',
    });
  });

  it('does not let another task replace an active agent lease', () => {
    const initial = createSessionState('session-1');
    const agentLease = grantAgentLease(initial, 'task-1', 0);
    if (!agentLease.ok) throw new Error('expected an agent lease');

    expect(grantAgentLease(agentLease.value, 'task-2', 1)).toEqual({
      ok: false,
      error: 'lease-unavailable',
    });
  });

  it('grants an external caller lease and rejects it when agent already owns the session', () => {
    const initial = createSessionState('session-1');
    const externalLease = grantExternalLease(initial, 'mcp-client', 0);

    expect(externalLease).toMatchObject({
      ok: true,
      value: { lease: { owner: { kind: 'external', callerId: 'mcp-client' }, epoch: 1 } },
    });
    if (!externalLease.ok) throw new Error('expected an external lease');

    const agentLease = grantAgentLease(initial, 'task-1', 0);
    if (!agentLease.ok) throw new Error('expected an agent lease');
    expect(grantExternalLease(agentLease.value, 'mcp-client', 1)).toEqual({
      ok: false,
      error: 'lease-unavailable',
    });
  });

  it('releases an external lease only for the caller holding the current epoch', () => {
    const initial = createSessionState('session-1');
    const externalLease = grantExternalLease(initial, 'mcp-client', 0);
    if (!externalLease.ok) throw new Error('expected an external lease');

    expect(releaseExternalLease(externalLease.value, 'mcp-client', 1)).toMatchObject({
      ok: true,
      value: { lease: { owner: { kind: 'none' }, epoch: 2 } },
    });
    expect(releaseExternalLease(externalLease.value, 'other-caller', 1)).toEqual({
      ok: false,
      error: 'lease-not-owned',
    });
    expect(releaseExternalLease(externalLease.value, 'mcp-client', 2)).toEqual({
      ok: false,
      error: 'stale-lease-epoch',
    });
  });

  it('lets user takeover invalidate an external lease immediately', () => {
    const initial = createSessionState('session-1');
    const externalLease = grantExternalLease(initial, 'mcp-client', 0);
    if (!externalLease.ok) throw new Error('expected an external lease');

    const userLease = takeUserLease(externalLease.value);
    expect(userLease.lease).toEqual({ owner: { kind: 'user' }, epoch: 2 });
    expect(grantExternalLease(userLease, 'mcp-client', 1)).toEqual({
      ok: false,
      error: 'stale-lease-epoch',
    });
  });

  it('releases control only for the task holding the current epoch', () => {
    const initial = createSessionState('session-1');
    const agentLease = grantAgentLease(initial, 'task-1', 0);
    if (!agentLease.ok) throw new Error('expected an agent lease');

    expect(releaseAgentLease(agentLease.value, 'task-1', 1)).toMatchObject({
      ok: true,
      value: { lease: { owner: { kind: 'none' }, epoch: 2 } },
    });
    expect(releaseAgentLease(agentLease.value, 'task-2', 1)).toEqual({
      ok: false,
      error: 'lease-not-owned',
    });
  });

  it('returns an agent lease to the user without invalidating the verified environment', () => {
    const initial = createSessionState('session-1', 'posix');
    const probing = transitionSessionShell(initial, 'probing');
    if (!probing.ok) throw new Error('expected shell probing');
    const ready = transitionSessionShell(probing.value, 'ready');
    if (!ready.ok) throw new Error('expected shell ready');
    const verified = {
      ...ready.value,
      environment: verifyEnvironment(
        ready.value.environment,
        'posix',
        'unix',
        () => '2026-07-30T00:00:00Z',
        'linux',
      ),
    };
    const agentLease = grantAgentLease(verified, 'task-1', 0);
    if (!agentLease.ok) throw new Error('expected an agent lease');

    expect(returnAgentLeaseToUser(agentLease.value, 'task-1', 1)).toMatchObject({
      ok: true,
      value: {
        shell: 'ready',
        lease: { owner: { kind: 'user' }, epoch: 2 },
        environment: {
          operatingSystem: 'linux',
          verificationStatus: 'verified',
          capabilityEpoch: verified.environment.capabilityEpoch,
        },
      },
    });
  });

  it('updates PTY, attachment, and shell capability independently', () => {
    const initial = createSessionState('session-1');
    const running = transitionSessionPty(initial, 'running');
    if (!running.ok) throw new Error('expected PTY to start');
    const attached = setSessionAttachment(running.value, 'attached');
    const probing = transitionSessionShell(attached, 'probing');
    if (!probing.ok) throw new Error('expected shell probing');
    const ready = transitionSessionShell(probing.value, 'ready');

    expect(ready).toMatchObject({
      ok: true,
      value: {
        pty: 'running',
        attachment: 'attached',
        shell: 'ready',
        lease: { owner: { kind: 'user' }, epoch: 0 },
      },
    });
  });

  it('requires a new probe after an interactive shell handoff', () => {
    const initial = createSessionState('session-1');
    const probing = transitionSessionShell(initial, 'probing');
    if (!probing.ok) throw new Error('expected shell probing');
    const ready = transitionSessionShell(probing.value, 'ready');
    if (!ready.ok) throw new Error('expected ready shell');
    const executing = transitionSessionShell(ready.value, 'executing');
    if (!executing.ok) throw new Error('expected executing shell');
    expect(transitionSessionShell(executing.value, 'ready')).toMatchObject({
      ok: true,
      value: { shell: 'ready' },
    });
    const takeover = transitionSessionShell(executing.value, 'interaction_required');
    if (!takeover.ok) throw new Error('expected user takeover');

    expect(transitionSessionShell(takeover.value, 'ready')).toEqual({
      ok: false,
      error: 'invalid-shell-transition',
    });
    expect(transitionSessionShell(takeover.value, 'probing')).toMatchObject({
      ok: true,
      value: { shell: 'probing' },
    });
  });

  it('returns to unknown without creating a capability epoch when a probe fails', () => {
    const initial = createSessionState('session-1');
    const probing = transitionSessionShell(initial, 'probing');
    if (!probing.ok) throw new Error('expected shell probing');

    expect(transitionSessionShell(probing.value, 'unknown')).toEqual({
      ok: true,
      value: {
        ...probing.value,
        shell: 'unknown',
      },
    });
  });

  it('invalidates stale shell capability epochs after human input', () => {
    const initial = createSessionState('session-1');
    const probing = transitionSessionShell(initial, 'probing');
    if (!probing.ok) throw new Error('expected shell probing');
    const ready = transitionSessionShell(probing.value, 'ready');
    if (!ready.ok) throw new Error('expected ready shell');

    expect(ready.value.shellCapabilityEpoch).toBe(1);
    const invalidated = invalidateShellCapability(ready.value);
    expect(invalidated).toMatchObject({
      shell: 'unknown',
      shellCapabilityEpoch: 2,
    });
    expect(invalidated.environment.verificationStatus).toBe('unverified');
    expect(invalidated.environment.capabilityEpoch).toBe(2);
  });

  it('verifies environment with fingerprint result', () => {
    const env = createExecutionEnvironment({ dialect: 'posix', platform: 'unknown' });
    expect(env.verificationStatus).toBe('unverified');

    const verified = verifyEnvironment(env, 'posix', 'unix', () => '2026-07-30T00:00:00Z', 'linux');
    expect(verified).toMatchObject({
      dialect: 'posix',
      platform: 'unix',
      operatingSystem: 'linux',
      verificationStatus: 'verified',
      capabilityEpoch: 1,
      verifiedAt: '2026-07-30T00:00:00Z',
      source: 'fingerprint',
    });
  });

  it('invalidates environment and bumps epoch', () => {
    const env = createExecutionEnvironment();
    const verified = verifyEnvironment(
      env,
      'powershell',
      'windows',
      () => '2026-07-30T00:00:00Z',
      'windows',
    );
    expect(verified.capabilityEpoch).toBe(1);
    expect(verified.operatingSystem).toBe('windows');

    const invalidated = invalidateEnvironment(verified);
    expect(invalidated.verificationStatus).toBe('unverified');
    expect(invalidated.capabilityEpoch).toBe(2);
    expect(invalidated.verifiedAt).toBeUndefined();
  });

  it('keeps PTY terminal states final', () => {
    const initial = createSessionState('session-1');

    for (const state of ['exited', 'failed', 'interrupted'] as const) {
      const terminal = transitionSessionPty(initial, state);
      expect(terminal).toMatchObject({ ok: true, value: { pty: state } });
      if (!terminal.ok) throw new Error(`expected ${state} PTY`);
      expect(transitionSessionPty(terminal.value, 'running')).toEqual({
        ok: false,
        error: 'invalid-pty-transition',
      });
    }
  });
});
