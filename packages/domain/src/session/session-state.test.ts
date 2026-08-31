import { describe, expect, it } from 'vitest';

import {
  createSessionState,
  invalidateSessionEnvironment,
  resizeSession,
  transitionSessionPty,
  verifySessionEnvironment,
} from './session-state.js';

describe('SessionState', () => {
  it('starts as starting and detached', () => {
    const state = createSessionState({
      id: 's1',
      title: '终端 1',
      terminalType: 'Zsh',
      columns: 100,
      rows: 30,
    });
    expect(state).toMatchObject({
      id: 's1',
      pty: 'starting',
      columns: 100,
      rows: 30,
    });
  });

  it('allows running then exit transitions', () => {
    const started = createSessionState({ id: 's1', title: 't', terminalType: 'Zsh' });
    const running = transitionSessionPty(started, 'running');
    expect(running.ok).toBe(true);
    if (!running.ok) return;
    const exited = transitionSessionPty(running.value, 'exited');
    expect(exited).toEqual({ ok: true, value: expect.objectContaining({ pty: 'exited' }) });
  });

  it('rejects invalid pty transitions', () => {
    const state = createSessionState({ id: 's1', title: 't', terminalType: 'Zsh' });
    const running = transitionSessionPty(state, 'running');
    if (!running.ok) throw new Error('expected running');
    expect(transitionSessionPty(running.value, 'starting')).toMatchObject({ ok: false });
  });

  it('tracks resize', () => {
    const state = createSessionState({ id: 's1', title: 't', terminalType: 'Zsh' });
    expect(resizeSession(state, 120, 40)).toMatchObject({ columns: 120, rows: 40 });
    expect(() => resizeSession(state, 0, 40)).toThrow(RangeError);
  });

  it('starts with an unverified current PTY environment instead of trusting the launch hint', () => {
    const state = createSessionState({ id: 's1', title: 't', terminalType: 'PowerShell' });

    expect(state.terminalType).toBe('PowerShell');
    expect(state.environment).toEqual({
      dialect: 'unknown',
      platform: 'unknown',
      verificationStatus: 'unverified',
      source: 'none',
      capabilityEpoch: 0,
      verifiedAt: undefined,
    });
  });

  it('increments the environment epoch when the current PTY environment is verified and invalidated', () => {
    const state = createSessionState({ id: 's1', title: 't', terminalType: 'PowerShell' });
    const verified = verifySessionEnvironment(state, {
      dialect: 'posix',
      platform: 'unix',
      source: 'probe',
      verifiedAt: '2026-08-31T00:00:00.000Z',
    });

    expect(verified.environment).toMatchObject({
      dialect: 'posix',
      platform: 'unix',
      verificationStatus: 'verified',
      source: 'probe',
      capabilityEpoch: 1,
      verifiedAt: '2026-08-31T00:00:00.000Z',
    });

    const invalidated = invalidateSessionEnvironment(verified);
    expect(invalidated.environment).toMatchObject({
      dialect: 'unknown',
      platform: 'unknown',
      verificationStatus: 'unverified',
      source: 'none',
      capabilityEpoch: 2,
    });
    expect(invalidated.environment.verifiedAt).toBeUndefined();
  });
});
