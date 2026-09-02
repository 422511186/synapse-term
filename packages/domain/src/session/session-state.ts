import type { ExecutionContextId } from './command-protocol.js';

export type PtyState = 'starting' | 'running' | 'exited' | 'failed' | 'interrupted';

export type ExecutionDialect = 'posix' | 'powershell' | 'unknown';
export type EnvironmentPlatform = 'windows' | 'unix' | 'unknown';
export type EnvironmentVerificationStatus = 'unverified' | 'verified';
export type EnvironmentSource = 'none' | 'probe';

export interface CurrentPtyEnvironment {
  dialect: ExecutionDialect;
  platform: EnvironmentPlatform;
  verificationStatus: EnvironmentVerificationStatus;
  source: EnvironmentSource;
  capabilityEpoch: number;
  verifiedAt: string | undefined;
}

export interface SessionState {
  id: string;
  executionContextId: ExecutionContextId;
  title: string;
  terminalType: string;
  pty: PtyState;
  columns: number;
  rows: number;
  /** 启动时的 Shell 提示；不能替代当前 PTY environment。 */
  environment: CurrentPtyEnvironment;
  /** 共享时间戳：仅当用户显式共享后存在（specs/mcp-access） */
  sharedAt?: string;
}

export interface VerifySessionEnvironmentInput {
  dialect: Exclude<ExecutionDialect, 'unknown'>;
  platform: Exclude<EnvironmentPlatform, 'unknown'>;
  source: 'probe';
  verifiedAt: string;
}

export interface CreateSessionStateInput {
  id: string;
  title: string;
  terminalType: string;
  executionContextId?: ExecutionContextId;
  columns?: number;
  rows?: number;
}

export type TransitionResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function createSessionState(input: CreateSessionStateInput): SessionState {
  return {
    id: input.id,
    executionContextId: input.executionContextId ?? `initial:${input.id}`,
    title: input.title,
    terminalType: input.terminalType,
    pty: 'starting',
    columns: input.columns ?? 80,
    rows: input.rows ?? 24,
    environment: {
      dialect: 'unknown',
      platform: 'unknown',
      verificationStatus: 'unverified',
      source: 'none',
      capabilityEpoch: 0,
      verifiedAt: undefined,
    },
  };
}

export function replaceSessionExecutionContext(
  state: SessionState,
  executionContextId: ExecutionContextId,
): SessionState {
  if (executionContextId.length === 0) throw new RangeError('executionContextId must not be empty');
  return { ...state, executionContextId };
}

export function verifySessionEnvironment(
  state: SessionState,
  input: VerifySessionEnvironmentInput,
): SessionState {
  return {
    ...state,
    environment: {
      ...input,
      verificationStatus: 'verified',
      capabilityEpoch: state.environment.capabilityEpoch + 1,
    },
  };
}

export function invalidateSessionEnvironment(state: SessionState): SessionState {
  return {
    ...state,
    environment: {
      dialect: 'unknown',
      platform: 'unknown',
      verificationStatus: 'unverified',
      source: 'none',
      capabilityEpoch: state.environment.capabilityEpoch + 1,
      verifiedAt: undefined,
    },
  };
}

const PTY_TRANSITIONS: Record<PtyState, readonly PtyState[]> = {
  starting: ['running', 'exited', 'failed', 'interrupted'],
  running: ['exited', 'failed', 'interrupted'],
  exited: [],
  failed: [],
  interrupted: [],
};

export function transitionSessionPty(
  state: SessionState,
  next: PtyState,
): TransitionResult<SessionState> {
  if (state.pty === next) return { ok: true, value: state };
  if (!PTY_TRANSITIONS[state.pty].includes(next)) {
    return { ok: false, error: `invalid pty transition: ${state.pty} -> ${next}` };
  }
  return { ok: true, value: { ...state, pty: next } };
}

export function resizeSession(state: SessionState, columns: number, rows: number): SessionState {
  if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) {
    throw new RangeError('terminal dimensions must be positive integers');
  }
  return { ...state, columns, rows };
}
