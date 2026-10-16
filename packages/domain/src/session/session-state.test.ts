import { describe, expect, it } from 'vitest';

import {
  createSessionState,
  invalidateSessionEnvironment,
  resizeSession,
  replaceSessionExecutionContext,
  selectWritePremise,
  transitionSessionPty,
  verifySessionEnvironment,
  type SessionAvailabilityFacts,
  type SessionState,
  type WritePremise,
  type WritePremiseError,
} from './session-state.js';

const AVAILABLE: SessionAvailabilityFacts = { disposed: false, cancelled: false };
const CANCELLED: SessionAvailabilityFacts = { disposed: false, cancelled: true };
const DISPOSED: SessionAvailabilityFacts = { disposed: true, cancelled: false };

function runningState(): SessionState {
  const created = createSessionState({
    id: 's1',
    title: 't',
    terminalType: 'Zsh',
    executionContextId: 'context-a',
  });
  const running = transitionSessionPty(created, 'running');
  if (!running.ok) throw new Error('expected running');
  return running.value;
}

function verifiedRunningState(): SessionState {
  return verifySessionEnvironment(runningState(), {
    dialect: 'posix',
    platform: 'unix',
    source: 'probe',
    verifiedAt: '2026-09-01T00:00:00.000Z',
  });
}

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
    expect(state.executionContextId).toBe('initial:s1');
    expect(state.environment).toEqual({
      dialect: 'unknown',
      platform: 'unknown',
      verificationStatus: 'unverified',
      source: 'none',
      capabilityEpoch: 0,
      verifiedAt: undefined,
    });
  });

  it('allows an execution context to be replaced independently of the environment epoch', () => {
    const state = createSessionState({
      id: 's1',
      title: 't',
      terminalType: 'PowerShell',
      executionContextId: 'context-a',
    });

    const next = replaceSessionExecutionContext(state, 'context-b');

    expect(next.executionContextId).toBe('context-b');
    expect(next.environment.capabilityEpoch).toBe(state.environment.capabilityEpoch);
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

describe('selectWritePremise', () => {
  const verified = verifiedRunningState();
  const verifiedEpoch = verified.environment.capabilityEpoch;

  const cases: Array<{
    name: string;
    state: SessionState;
    premise: WritePremise;
    availability: SessionAvailabilityFacts;
    expected: WritePremiseError | undefined;
  }> = [
    {
      name: 'environment-and-context 在全部前提成立时放行',
      state: verified,
      premise: {
        precondition: 'environment-and-context',
        environmentEpoch: verifiedEpoch,
        executionContextId: 'context-a',
      },
      availability: AVAILABLE,
      expected: undefined,
    },
    {
      name: 'environment-and-context 在取消事实成立时返回取消',
      state: verified,
      premise: {
        precondition: 'environment-and-context',
        environmentEpoch: verifiedEpoch,
        executionContextId: 'context-a',
      },
      availability: CANCELLED,
      expected: 'external-write-cancelled',
    },
    {
      name: 'environment-and-context 在已释放时返回未运行',
      state: verified,
      premise: {
        precondition: 'environment-and-context',
        environmentEpoch: verifiedEpoch,
        executionContextId: 'context-a',
      },
      availability: DISPOSED,
      expected: 'session-not-running',
    },
    {
      name: 'environment-and-context 在 PTY 未运行时不放行',
      state: createSessionState({
        id: 's1',
        title: 't',
        terminalType: 'Zsh',
        executionContextId: 'context-a',
      }),
      premise: {
        precondition: 'environment-and-context',
        environmentEpoch: 0,
        executionContextId: 'context-a',
      },
      availability: AVAILABLE,
      expected: 'session-not-running',
    },
    {
      name: 'environment-and-context 在 environment 未验证时返回未验证',
      state: runningState(),
      premise: {
        precondition: 'environment-and-context',
        environmentEpoch: 0,
        executionContextId: 'context-a',
      },
      availability: AVAILABLE,
      expected: 'environment-unverified',
    },
    {
      name: 'environment-and-context 在 epoch 不匹配时返回过期 epoch',
      state: verified,
      premise: {
        precondition: 'environment-and-context',
        environmentEpoch: verifiedEpoch + 1,
        executionContextId: 'context-a',
      },
      availability: AVAILABLE,
      expected: 'stale-environment-epoch',
    },
    {
      name: 'environment-and-context 在 executionContextId 不匹配时返回过期上下文',
      state: verified,
      premise: {
        precondition: 'environment-and-context',
        environmentEpoch: verifiedEpoch,
        executionContextId: 'context-b',
      },
      availability: AVAILABLE,
      expected: 'stale-execution-context',
    },
    {
      name: 'environment 在 environment 已验证时放行，不要求 epoch 与上下文',
      state: verified,
      premise: { precondition: 'environment' },
      availability: AVAILABLE,
      expected: undefined,
    },
    {
      name: 'environment 在 environment 未验证时返回未验证',
      state: runningState(),
      premise: { precondition: 'environment' },
      availability: AVAILABLE,
      expected: 'environment-unverified',
    },
    {
      name: 'environment 在取消事实成立时返回取消',
      state: runningState(),
      premise: { precondition: 'environment' },
      availability: CANCELLED,
      expected: 'external-write-cancelled',
    },
    {
      name: 'context 在 executionContextId 匹配时放行，不要求 environment 验证',
      state: runningState(),
      premise: { precondition: 'context', executionContextId: 'context-a' },
      availability: AVAILABLE,
      expected: undefined,
    },
    {
      name: 'context 在 executionContextId 不匹配时返回过期上下文',
      state: verified,
      premise: { precondition: 'context', executionContextId: 'context-b' },
      availability: AVAILABLE,
      expected: 'stale-execution-context',
    },
    {
      name: 'context 在已释放时返回未运行',
      state: verified,
      premise: { precondition: 'context', executionContextId: 'context-a' },
      availability: DISPOSED,
      expected: 'session-not-running',
    },
    {
      name: 'session 在 PTY 运行、未验证 environment 时仍放行',
      state: runningState(),
      premise: { precondition: 'session' },
      availability: AVAILABLE,
      expected: undefined,
    },
    {
      name: 'session 在 PTY 未运行时不放行',
      state: createSessionState({ id: 's1', title: 't', terminalType: 'Zsh' }),
      premise: { precondition: 'session' },
      availability: AVAILABLE,
      expected: 'session-not-running',
    },
    {
      name: 'session 在取消事实成立时返回取消',
      state: runningState(),
      premise: { precondition: 'session' },
      availability: CANCELLED,
      expected: 'external-write-cancelled',
    },
  ];

  it.each(cases)('$name', ({ state, premise, availability, expected }) => {
    expect(selectWritePremise(state, premise, availability)).toBe(expected);
  });
});
