export type PtyState = 'starting' | 'running' | 'exited' | 'failed' | 'interrupted';
export type AttachmentState = 'attached' | 'detached';
export type ShellState = 'unknown' | 'probing' | 'ready' | 'executing' | 'interaction_required';
export type ExecutionDialect = 'posix' | 'powershell' | 'observe_only';
export type EnvironmentPlatform = 'windows' | 'unix' | 'unknown';
export type EnvironmentOperatingSystem = 'windows' | 'linux' | 'macos' | 'unknown';
export type EnvironmentVerificationStatus = 'unverified' | 'verified' | 'observation_only';
export type TransportMode = 'plaintext' | 'direct_argv' | 'user_input' | 'rejected';
export type SourceKind = 'plaintext_shell' | 'user_input' | 'direct_argv' | 'data_encoding';

export interface ExecutionEnvironment {
  readonly dialect: ExecutionDialect;
  readonly platform: EnvironmentPlatform;
  readonly operatingSystem: EnvironmentOperatingSystem;
  readonly verificationStatus: EnvironmentVerificationStatus;
  readonly capabilityEpoch: number;
  readonly verifiedAt?: string | undefined;
  readonly source?: 'fingerprint' | 'manual_hint' | undefined;
}

export interface EnvironmentHint {
  readonly dialect: ExecutionDialect;
  readonly platform: EnvironmentPlatform;
  readonly operatingSystem?: EnvironmentOperatingSystem | undefined;
}

export function createExecutionEnvironment(hint?: EnvironmentHint): ExecutionEnvironment {
  const env: ExecutionEnvironment = {
    dialect: hint?.dialect ?? 'observe_only',
    platform: hint?.platform ?? 'unknown',
    operatingSystem: hint?.operatingSystem ?? 'unknown',
    verificationStatus: 'unverified',
    capabilityEpoch: 0,
  };
  if (hint !== undefined) {
    return { ...env, source: 'manual_hint' };
  }
  return env;
}

export function verifyEnvironment(
  env: ExecutionEnvironment,
  dialect: ExecutionDialect,
  platform: EnvironmentPlatform,
  now: () => string,
  operatingSystem: EnvironmentOperatingSystem = platform === 'windows'
    ? 'windows'
    : platform === 'unix'
      ? 'linux'
      : 'unknown',
): ExecutionEnvironment {
  return {
    ...env,
    dialect,
    platform,
    operatingSystem,
    verificationStatus: 'verified',
    capabilityEpoch: env.capabilityEpoch + 1,
    verifiedAt: now(),
    source: 'fingerprint',
  };
}

export function invalidateEnvironment(env: ExecutionEnvironment): ExecutionEnvironment {
  return {
    dialect: env.dialect,
    platform: env.platform,
    operatingSystem: env.operatingSystem,
    verificationStatus: 'unverified',
    capabilityEpoch: env.capabilityEpoch + 1,
    ...(env.source === undefined ? {} : { source: env.source }),
  };
}

export function setEnvironmentObservationOnly(env: ExecutionEnvironment): ExecutionEnvironment {
  return {
    ...env,
    verificationStatus: 'observation_only',
  };
}

export type LeaseOwner =
  | { kind: 'user' }
  | { kind: 'agent'; taskId: string }
  | { kind: 'external'; callerId: string }
  | { kind: 'none' };

export interface SessionLease {
  owner: LeaseOwner;
  epoch: number;
}

export interface SessionState {
  id: string;
  pty: PtyState;
  attachment: AttachmentState;
  shell: ShellState;
  executionDialect: ExecutionDialect;
  shellCapabilityEpoch: number;
  lease: SessionLease;
  environment: ExecutionEnvironment;
  /** 用户显式复制 sessionId 后才存在；仅标记可寻址，不改变 Lease 与安全边界 */
  sharedAt?: string | undefined;
}

export type TransitionResult<T, E extends string> =
  { ok: true; value: T } | { ok: false; error: E };

export function createSessionState(
  id: string,
  executionDialect: ExecutionDialect = 'observe_only',
): SessionState {
  const hint: EnvironmentHint | undefined =
    executionDialect !== 'observe_only'
      ? { dialect: executionDialect, platform: 'unknown' }
      : undefined;
  return {
    id,
    pty: 'starting',
    attachment: 'detached',
    shell: 'unknown',
    executionDialect,
    shellCapabilityEpoch: 0,
    lease: { owner: { kind: 'user' }, epoch: 0 },
    environment: createExecutionEnvironment(hint),
  };
}

export function setSessionExecutionDialect(
  session: SessionState,
  executionDialect: ExecutionDialect,
): SessionState {
  if (session.executionDialect === executionDialect) return session;
  return {
    ...session,
    executionDialect,
    shell: 'unknown',
    shellCapabilityEpoch: session.shellCapabilityEpoch + 1,
    environment: invalidateEnvironment({
      ...session.environment,
      dialect: executionDialect,
    }),
  };
}

export function grantAgentLease(
  session: SessionState,
  taskId: string,
  expectedEpoch: number,
): TransitionResult<SessionState, 'stale-lease-epoch' | 'lease-unavailable'> {
  if (session.lease.epoch !== expectedEpoch) {
    return { ok: false, error: 'stale-lease-epoch' };
  }

  if (session.lease.owner.kind === 'agent') {
    return { ok: false, error: 'lease-unavailable' };
  }

  return {
    ok: true,
    value: {
      ...session,
      lease: {
        owner: { kind: 'agent', taskId },
        epoch: session.lease.epoch + 1,
      },
    },
  };
}

/**
 * 外部调用者 JIT 租约（specs/mcp-access、ADR-0024）
 *
 * 外部调用（MCP / ACP）以"外部调用者"身份持有租约，与用户、内置 Agent 三方互斥；
 * 用户接管 epoch 递增后，外部租约立即失效。callerId 仅作身份归属，不创建 Task/Turn。
 */
export function grantExternalLease(
  session: SessionState,
  callerId: string,
  expectedEpoch: number,
): TransitionResult<SessionState, 'stale-lease-epoch' | 'lease-unavailable'> {
  if (session.lease.epoch !== expectedEpoch) {
    return { ok: false, error: 'stale-lease-epoch' };
  }

  if (session.lease.owner.kind === 'agent' || session.lease.owner.kind === 'external') {
    return { ok: false, error: 'lease-unavailable' };
  }

  return {
    ok: true,
    value: {
      ...session,
      lease: {
        owner: { kind: 'external', callerId },
        epoch: session.lease.epoch + 1,
      },
    },
  };
}

export function takeUserLease(session: SessionState): SessionState {
  return {
    ...session,
    lease: {
      owner: { kind: 'user' },
      epoch: session.lease.epoch + 1,
    },
  };
}

export function releaseAgentLease(
  session: SessionState,
  taskId: string,
  expectedEpoch: number,
): TransitionResult<SessionState, 'stale-lease-epoch' | 'lease-not-owned'> {
  if (session.lease.epoch !== expectedEpoch) {
    return { ok: false, error: 'stale-lease-epoch' };
  }

  if (session.lease.owner.kind !== 'agent' || session.lease.owner.taskId !== taskId) {
    return { ok: false, error: 'lease-not-owned' };
  }

  return {
    ok: true,
    value: {
      ...session,
      lease: {
        owner: { kind: 'none' },
        epoch: session.lease.epoch + 1,
      },
    },
  };
}

export function releaseExternalLease(
  session: SessionState,
  callerId: string,
  expectedEpoch: number,
): TransitionResult<SessionState, 'stale-lease-epoch' | 'lease-not-owned'> {
  if (session.lease.epoch !== expectedEpoch) {
    return { ok: false, error: 'stale-lease-epoch' };
  }

  if (session.lease.owner.kind !== 'external' || session.lease.owner.callerId !== callerId) {
    return { ok: false, error: 'lease-not-owned' };
  }

  return {
    ok: true,
    value: {
      ...session,
      lease: {
        owner: { kind: 'none' },
        epoch: session.lease.epoch + 1,
      },
    },
  };
}

export function returnAgentLeaseToUser(
  session: SessionState,
  taskId: string,
  expectedEpoch: number,
): TransitionResult<SessionState, 'stale-lease-epoch' | 'lease-not-owned'> {
  if (session.lease.epoch !== expectedEpoch) {
    return { ok: false, error: 'stale-lease-epoch' };
  }

  if (session.lease.owner.kind !== 'agent' || session.lease.owner.taskId !== taskId) {
    return { ok: false, error: 'lease-not-owned' };
  }

  return {
    ok: true,
    value: {
      ...session,
      lease: {
        owner: { kind: 'user' },
        epoch: session.lease.epoch + 1,
      },
    },
  };
}

export function transitionSessionPty(
  session: SessionState,
  nextState: PtyState,
): TransitionResult<SessionState, 'invalid-pty-transition'> {
  const allowedTransitions: Readonly<Record<PtyState, readonly PtyState[]>> = {
    starting: ['running', 'exited', 'failed', 'interrupted'],
    running: ['exited', 'failed', 'interrupted'],
    exited: [],
    failed: [],
    interrupted: [],
  };

  if (!allowedTransitions[session.pty].includes(nextState)) {
    return { ok: false, error: 'invalid-pty-transition' };
  }

  return { ok: true, value: { ...session, pty: nextState } };
}

export function setSessionAttachment(
  session: SessionState,
  attachment: AttachmentState,
): SessionState {
  return { ...session, attachment };
}

export function transitionSessionShell(
  session: SessionState,
  nextState: ShellState,
): TransitionResult<SessionState, 'invalid-shell-transition'> {
  const allowedTransitions: Readonly<Record<ShellState, readonly ShellState[]>> = {
    unknown: ['probing'],
    probing: ['unknown', 'ready'],
    ready: ['executing'],
    executing: ['ready', 'interaction_required'],
    interaction_required: ['probing'],
  };

  if (!allowedTransitions[session.shell].includes(nextState)) {
    return { ok: false, error: 'invalid-shell-transition' };
  }

  const updated = {
    ...session,
    shell: nextState,
    shellCapabilityEpoch:
      nextState === 'ready' ? session.shellCapabilityEpoch + 1 : session.shellCapabilityEpoch,
  };
  // Auto-verify environment when transitioning to ready (probe has confirmed dialect)
  if (nextState === 'ready' && session.environment.verificationStatus !== 'verified') {
    return {
      ok: true,
      value: {
        ...updated,
        environment: {
          ...updated.environment,
          verificationStatus: 'verified',
          capabilityEpoch: updated.environment.capabilityEpoch + 1,
          verifiedAt: new Date().toISOString(),
          source: 'fingerprint',
        },
      },
    };
  }
  return {
    ok: true,
    value: updated,
  };
}

export function invalidateShellCapability(session: SessionState): SessionState {
  return {
    ...session,
    shell: 'unknown',
    shellCapabilityEpoch: session.shellCapabilityEpoch + 1,
    environment: invalidateEnvironment(session.environment),
  };
}
