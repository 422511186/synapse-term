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

/**
 * 写入前提：这条写入要求哪些已建立的执行前提。
 *
 * `session` 只要求 Session 未被释放且 PTY 在运行，用于本地用户输入与本地诊断写入。
 */
export type WritePrecondition = 'environment-and-context' | 'environment' | 'context' | 'session';

/** 写入前提不成立时的本地判定结果；调用方负责把它映射为对外稳定错误码。 */
export type WritePremiseError =
  | 'session-not-running'
  | 'external-write-cancelled'
  | 'environment-unverified'
  | 'stale-environment-epoch'
  | 'stale-execution-context';

/** 前提描述直接携带该前提需要的期望值，调用方无法漏传必需字段。 */
export type WritePremise =
  | {
      precondition: 'environment-and-context';
      environmentEpoch: number;
      executionContextId: ExecutionContextId;
    }
  | { precondition: 'environment' }
  | { precondition: 'context'; executionContextId: ExecutionContextId }
  | { precondition: 'session' };

export interface SessionAvailabilityFacts {
  /** SessionActor 是否已释放；`dispose()` 不改变 `SessionState.pty`，因此必须显式传入。 */
  disposed: boolean;
  /** 由持有串行队列的一方求值得到的取消事实。 */
  cancelled: boolean;
}

/** 前提成立后这条写入对当前 PTY 环境与执行上下文造成的后果。 */
export interface WriteEffects {
  invalidatesEnvironmentBeforeWrite: boolean;
  rotatesExecutionContextAfterWrite: boolean;
}

const PREMISE_REQUIREMENTS: Readonly<
  Record<
    WritePrecondition,
    { environment: boolean; environmentEpoch: boolean; executionContext: boolean }
  >
> = {
  'environment-and-context': { environment: true, environmentEpoch: true, executionContext: true },
  environment: { environment: true, environmentEpoch: false, executionContext: false },
  context: { environment: false, environmentEpoch: false, executionContext: true },
  session: { environment: false, environmentEpoch: false, executionContext: false },
};

export const WRITE_EFFECTS: Readonly<Record<WritePrecondition, WriteEffects>> = {
  'environment-and-context': {
    invalidatesEnvironmentBeforeWrite: false,
    rotatesExecutionContextAfterWrite: true,
  },
  environment: {
    invalidatesEnvironmentBeforeWrite: false,
    rotatesExecutionContextAfterWrite: false,
  },
  context: {
    invalidatesEnvironmentBeforeWrite: true,
    rotatesExecutionContextAfterWrite: false,
  },
  session: {
    invalidatesEnvironmentBeforeWrite: false,
    rotatesExecutionContextAfterWrite: false,
  },
};

/**
 * 判定一次写入的前提，判定顺序固定为：已取消 → 未运行/已释放 → environment 未验证 →
 * epoch 不匹配 → executionContextId 不匹配。只有该前提确实要求的项才参与判定。
 */
export function selectWritePremise(
  state: SessionState,
  premise: WritePremise,
  availability: SessionAvailabilityFacts,
): WritePremiseError | undefined {
  if (availability.cancelled) return 'external-write-cancelled';
  if (availability.disposed || state.pty !== 'running') return 'session-not-running';
  const requirements = PREMISE_REQUIREMENTS[premise.precondition];
  if (requirements.environment && state.environment.verificationStatus !== 'verified') {
    return 'environment-unverified';
  }
  if (
    requirements.environmentEpoch &&
    premise.precondition === 'environment-and-context' &&
    state.environment.capabilityEpoch !== premise.environmentEpoch
  ) {
    return 'stale-environment-epoch';
  }
  if (
    requirements.executionContext &&
    premise.precondition !== 'environment' &&
    premise.precondition !== 'session' &&
    state.executionContextId !== premise.executionContextId
  ) {
    return 'stale-execution-context';
  }
  return undefined;
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
