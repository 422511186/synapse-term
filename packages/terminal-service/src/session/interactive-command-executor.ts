import { createHash, randomUUID } from 'node:crypto';

import type {
  CommandRisk,
  CommandRiskEvidence,
  CompletionMetadata,
  ExecutionContextId,
  ExternalTransactionStatus,
  InputGrantId,
  InputGrantMode,
  InputKey,
  InputRequestId,
  OutputCursor,
  TransactionId,
  TransactionOutputRange,
} from '@synapse-term/domain';

import {
  resolveShellDriver,
  ShellDriverError,
  type ShellCommandDispatch,
  type ShellDispatch,
  type ShellDriver,
} from '../shell/shell-driver.js';
import type { ExternalLeaseHandle } from './external-lease.js';
import { OutputBuffer, type OutputSnapshot } from './output-buffer.js';
import type {
  InteractiveInputWriteResult,
  SessionActor,
  SessionActorEvent,
} from './session-actor.js';

export interface InteractiveInputPayload {
  /** 已规范化、按“先文本后按键”合并的 PTY payload。 */
  readonly data: string;
  /** 规范化后的文本部分；管线输入编码器会提供。 */
  readonly normalizedText?: string | undefined;
  readonly textLength: number;
  readonly keys: readonly InputKey[];
  readonly payloadBytes: number;
  /** 去重用摘要；未提供时由 data 和 keys 生成。 */
  readonly payloadHash?: string | undefined;
}

export interface StartInteractiveInput {
  command: string;
  expectedContextId: ExecutionContextId;
  expectedEnvironmentEpoch?: number | undefined;
  inputGrantMode: InputGrantMode;
  callerId?: string | undefined;
  risk?: CommandRisk | undefined;
  riskEvidence?: CommandRiskEvidence | undefined;
  lease?: ExternalLeaseHandle | undefined;
}

export interface InteractiveInputRequest {
  transactionId: TransactionId;
  inputGrantId: InputGrantId;
  inputRequestId: InputRequestId;
  payload: InteractiveInputPayload;
  callerId?: string | undefined;
}

export interface FinishInteractiveInput {
  transactionId: TransactionId;
  observedCursor: OutputCursor;
  callerId?: string | undefined;
}

export interface InteractiveWaitInput {
  transactionId: TransactionId;
  timeoutMs?: number | undefined;
}

export interface InteractiveTransaction {
  id: TransactionId;
  sessionId: string;
  kind: 'interactive';
  command: string;
  nonce: string;
  inputGrantId: InputGrantId;
  inputGrantMode: InputGrantMode;
  risk?: CommandRisk | undefined;
  riskEvidence?: CommandRiskEvidence | undefined;
  status: ExternalTransactionStatus;
  outputRange: TransactionOutputRange;
  completion: CompletionMetadata;
  retryable: false;
  safeToResubmit: false;
  exitCode?: number | undefined;
  reason?: string | undefined;
}

export interface SentInputMetadata {
  textLength: number;
  keys: readonly InputKey[];
  payloadBytes: number;
}

export interface InteractiveExecutionResult {
  transaction: InteractiveTransaction;
  status: ExternalTransactionStatus;
  output: OutputSnapshot;
  cursor: OutputCursor;
  nextCursor: OutputCursor;
  outputRange: TransactionOutputRange;
  executionContextId: ExecutionContextId;
  completion: CompletionMetadata;
  retryable: false;
  safeToResubmit: false;
  inputGrantId?: InputGrantId | undefined;
  inputGrantMode?: InputGrantMode | undefined;
  sent?: SentInputMetadata | undefined;
  waitTimedOut?: boolean | undefined;
}

export type InteractiveCommandExecutorEvent =
  | { type: 'started'; transaction: InteractiveTransaction }
  | { type: 'finished'; transaction: InteractiveTransaction };

export class InteractiveCommandExecutorError extends Error {
  readonly code: string;

  constructor(code: string, message: string, guidance: string) {
    super(`${code}: ${message} ${guidance}`);
    this.name = code;
    this.code = code;
  }
}

export interface InteractiveCommandExecutorOptions {
  idFactory?: () => string;
  nonceFactory?: () => string;
  inputGrantIdFactory?: () => string;
  observationWindowMs?: number;
  finishTimeoutMs?: number;
  completionDrainMs?: number;
  completionEchoGraceMs?: number;
  idleTimeoutMs?: number;
  outputMaxBytes?: number;
  outputCursor?: (() => OutputCursor) | undefined;
  validateObservedCursor?:
    ((cursor: OutputCursor, minimumCursor: OutputCursor | undefined) => void) | undefined;
}

interface InputGrantState {
  id: InputGrantId;
  mode: InputGrantMode;
  callsUsed: number;
  bytesUsed: number;
  lastInputAt: number;
  revoked: boolean;
}

interface InputRecord {
  mode: 'transactional';
  transactionId: TransactionId;
  grantId: InputGrantId;
  payloadHash: string;
  promise: Promise<InteractiveExecutionResult>;
  resolve: (result: InteractiveExecutionResult) => void;
  reject: (error: unknown) => void;
  outcome?: InteractiveExecutionResult | undefined;
  error?: InteractiveCommandExecutorError | undefined;
}

interface ActiveRun {
  transaction: InteractiveTransaction;
  startDispatch: ShellCommandDispatch;
  driver: ShellDriver;
  environmentEpoch: number;
  executionContextIdBeforeStart: ExecutionContextId;
  buffer: OutputBuffer;
  listener: () => void;
  callerId: string | undefined;
  lease: ExternalLeaseHandle | undefined;
  grant: InputGrantState;
  inputRecords: Map<string, InputRecord>;
  initialResolved: boolean;
  sent: boolean;
  phase: 'starting' | 'running' | 'finishing' | 'interrupting' | 'settling' | 'settled';
  finishNonce?: string | undefined;
  finishEchoPattern?: ShellDispatch['echoPattern'] | undefined;
  finishPromise?: Promise<InteractiveExecutionResult> | undefined;
  finishResolve?: ((result: InteractiveExecutionResult) => void) | undefined;
  finishReject?: ((error: unknown) => void) | undefined;
  completionExitCode?: number | undefined;
  completionDrainTimer?: NodeJS.Timeout | undefined;
  finishTimer?: NodeJS.Timeout | undefined;
  idleTimer?: NodeJS.Timeout | undefined;
  lastInputCursor?: OutputCursor | undefined;
  environmentInvalidated: boolean;
  waiters: Set<PendingWaiter>;
  settledPromise: Promise<void>;
  resolveSettled: () => void;
}

interface PendingWaiter {
  resolve: (result: InteractiveExecutionResult) => void;
  timer?: NodeJS.Timeout | undefined;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const MAX_WAIT_TIMEOUT_MS = 60_000;
const DEFAULT_FINISH_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_OBSERVATION_WINDOW_MS = 300;
const MAX_INPUT_TEXT_BYTES = 8 * 1024;
const MAX_INPUT_PAYLOAD_BYTES = 16 * 1024;
const MAX_INPUT_KEYS = 128;
const BOUNDED_MAX_CALLS = 256;
const BOUNDED_MAX_BYTES = 256 * 1024;

export class InteractiveCommandExecutor {
  readonly #actor: SessionActor;
  readonly #options: Required<
    Pick<
      InteractiveCommandExecutorOptions,
      | 'idFactory'
      | 'nonceFactory'
      | 'inputGrantIdFactory'
      | 'observationWindowMs'
      | 'finishTimeoutMs'
      | 'completionDrainMs'
      | 'completionEchoGraceMs'
      | 'idleTimeoutMs'
      | 'outputMaxBytes'
    >
  > &
    Pick<InteractiveCommandExecutorOptions, 'outputCursor' | 'validateObservedCursor'>;
  readonly #listeners = new Set<(event: InteractiveCommandExecutorEvent) => void>();
  readonly #history = new Map<string, InteractiveExecutionResult>();
  readonly #inputHistory = new Map<string, InputRecord>();
  #active: ActiveRun | undefined;
  #disposed = false;
  #queue: Promise<void> = Promise.resolve();
  #disposePromise: Promise<void> | undefined;

  constructor(actor: SessionActor, options: InteractiveCommandExecutorOptions = {}) {
    this.#actor = actor;
    this.#options = {
      idFactory: options.idFactory ?? randomUUID,
      nonceFactory: options.nonceFactory ?? randomUUID,
      inputGrantIdFactory: options.inputGrantIdFactory ?? randomUUID,
      observationWindowMs: options.observationWindowMs ?? DEFAULT_OBSERVATION_WINDOW_MS,
      finishTimeoutMs: options.finishTimeoutMs ?? DEFAULT_FINISH_TIMEOUT_MS,
      completionDrainMs: options.completionDrainMs ?? 50,
      completionEchoGraceMs: options.completionEchoGraceMs ?? 250,
      idleTimeoutMs: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      outputMaxBytes: options.outputMaxBytes ?? 64 * 1024,
      outputCursor: options.outputCursor,
      validateObservedCursor: options.validateObservedCursor,
    };
    assertNonNegativeFinite(this.#options.observationWindowMs, 'observationWindowMs');
    assertPositiveFinite(this.#options.finishTimeoutMs, 'finishTimeoutMs');
    assertNonNegativeFinite(this.#options.completionDrainMs, 'completionDrainMs');
    assertNonNegativeFinite(this.#options.completionEchoGraceMs, 'completionEchoGraceMs');
    assertPositiveFinite(this.#options.idleTimeoutMs, 'idleTimeoutMs');
    if (!Number.isSafeInteger(this.#options.outputMaxBytes) || this.#options.outputMaxBytes < 1) {
      throw new RangeError('outputMaxBytes must be a positive safe integer');
    }
  }

  get activeTransactionId(): TransactionId | undefined {
    return this.#active?.transaction.id;
  }

  get activeTransactionKind(): 'interactive' | undefined {
    return this.#active === undefined ? undefined : 'interactive';
  }

  get activeStatus(): ExternalTransactionStatus | undefined {
    return this.#active?.transaction.status;
  }

  onEvent(listener: (event: InteractiveCommandExecutorEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  start(input: StartInteractiveInput): Promise<InteractiveExecutionResult> {
    return this.#enqueue(() => this.#start(input));
  }

  async input(request: InteractiveInputRequest): Promise<InteractiveExecutionResult> {
    return this.#enqueue(() => this.#input(request));
  }

  finish(input: FinishInteractiveInput): Promise<InteractiveExecutionResult> {
    return this.#enqueue(async () => {
      const run = this.#findActive(input.transactionId);
      this.#assertCaller(run, input.callerId);
      if (run.phase === 'finishing') {
        return { pending: run.finishPromise! };
      }
      if (run.phase !== 'running') {
        throw this.#transactionNotFound(input.transactionId);
      }
      if (
        run.environmentInvalidated ||
        this.#actor.snapshot.pty !== 'running' ||
        this.#actor.snapshot.environment.verificationStatus !== 'verified'
      ) {
        await this.#settle(run, {
          status: 'unknown',
          reason: 'current PTY environment was invalidated before finalization',
        });
        throw this.#transactionNotFound(input.transactionId);
      }
      if (typeof input.observedCursor !== 'string' || input.observedCursor.length === 0) {
        throw new InteractiveCommandExecutorError(
          'OUTPUT_CURSOR_STALE',
          'observedCursor is required before interactive finalization',
          '请先调用 synapse_observe 并使用最近一次响应的 nextCursor。',
        );
      }
      try {
        this.#options.validateObservedCursor?.(input.observedCursor, run.lastInputCursor);
      } catch (error) {
        throw new InteractiveCommandExecutorError(
          'OUTPUT_CURSOR_STALE',
          error instanceof Error ? error.message : 'observedCursor is not valid for this Sharing',
          '请重新调用 synapse_observe，并使用当前 Sharing 返回的 nextCursor。',
        );
      }
      const deferred = createDeferred<InteractiveExecutionResult>();
      run.phase = 'finishing';
      run.finishPromise = deferred.promise;
      run.finishResolve = deferred.resolve;
      run.finishReject = deferred.reject;
      void this.#sendFinish(run).catch((error: unknown) => {
        void this.#settle(run, {
          status: 'unknown',
          reason: error instanceof Error ? error.message : String(error),
        });
      });
      return { pending: deferred.promise };
    }).then((value) => value.pending);
  }

  async wait(input: InteractiveWaitInput): Promise<InteractiveExecutionResult> {
    const timeoutMs = normalizeWaitTimeout(input.timeoutMs);
    const active = this.#active;
    if (active?.transaction.id === input.transactionId) {
      if (active.phase === 'settled') return this.#snapshotResult(active);
      if (timeoutMs === 0) return this.#snapshotResult(active, true);
      return new Promise((resolve) => {
        const waiter: PendingWaiter = { resolve };
        waiter.timer = setTimeout(() => {
          if (!active.waiters.delete(waiter)) return;
          waiter.resolve(this.#snapshotResult(active, true));
        }, timeoutMs);
        active.waiters.add(waiter);
      });
    }
    const stored = this.#history.get(input.transactionId);
    if (stored === undefined) throw this.#transactionNotFound(input.transactionId);
    return structuredClone(stored);
  }

  get(transactionId: TransactionId): InteractiveExecutionResult | undefined {
    if (this.#active?.transaction.id === transactionId) return this.#snapshotResult(this.#active);
    return structuredClone(this.#history.get(transactionId));
  }

  async interrupt(transactionId: TransactionId, callerId?: string): Promise<boolean> {
    return this.#enqueue(async () => {
      const run = this.#active;
      if (run === undefined || run.transaction.id !== transactionId) return false;
      this.#assertCaller(run, callerId);
      if (run.phase === 'finishing' || run.phase === 'interrupting' || run.phase === 'settling') {
        throw new InteractiveCommandExecutorError(
          'SESSION_BUSY',
          'interactive finalization is already in progress',
          '请等待当前交互事务收敛。',
        );
      }
      if (run.phase !== 'running') return false;
      if (
        run.environmentInvalidated ||
        this.#actor.snapshot.environment.verificationStatus !== 'verified'
      ) {
        await this.#settle(run, {
          status: 'unknown',
          reason: 'current PTY environment was invalidated before the interrupt was delivered',
        });
        return true;
      }
      run.phase = 'interrupting';
      try {
        await this.#actor.interrupt();
        if (
          run.environmentInvalidated ||
          this.#actor.snapshot.pty !== 'running' ||
          this.#actor.snapshot.environment.verificationStatus !== 'verified'
        ) {
          await this.#settle(run, {
            status: 'unknown',
            reason: 'current PTY environment was invalidated before the interrupt was delivered',
          });
        } else {
          await this.#settle(run, {
            status: 'interrupted',
            reason: 'PTY interrupt requested; remote process termination is not confirmed',
          });
        }
      } catch (error) {
        await this.#settle(run, {
          status: 'unknown',
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      return true;
    });
  }

  clear(): Promise<void> {
    if (this.#disposePromise !== undefined) return this.#disposePromise;
    this.#disposed = true;
    this.#inputHistory.clear();
    this.#disposePromise = this.#enqueue(async () => {
      const active = this.#active;
      if (active !== undefined && active.phase !== 'settled') {
        if (active.phase === 'starting' && !active.sent) {
          this.#rejectStart(
            active,
            new InteractiveCommandExecutorError(
              'SESSION_EXPIRED',
              'interactive executor was cleared before the command was written',
              '请重新共享 Session 后先观察再启动交互事务。',
            ),
          );
        } else {
          await this.#settle(active, {
            status: 'unknown',
            reason: 'interactive executor was cleared before completion evidence',
          });
        }
      }
      this.#listeners.clear();
    });
    return this.#disposePromise;
  }

  async #start(input: StartInteractiveInput): Promise<InteractiveExecutionResult> {
    if (this.#disposed) throw this.#expiredError();
    if (input.inputGrantMode !== 'one_shot' && input.inputGrantMode !== 'bounded') {
      throw new InteractiveCommandExecutorError(
        'POLICY_DENIED',
        'input grant mode is invalid',
        '请选择 one_shot 或 bounded 的有限输入授权档位。',
      );
    }
    const snapshot = this.#actor.snapshot;
    if (snapshot.pty !== 'running') throw this.#notReadyError();
    if (this.#active !== undefined) {
      throw new InteractiveCommandExecutorError(
        'SESSION_BUSY',
        'another external transaction is active',
        '请先等待或中断当前事务。',
      );
    }
    if (snapshot.executionContextId !== input.expectedContextId) {
      throw new InteractiveCommandExecutorError(
        'EXECUTION_CONTEXT_STALE',
        'the supplied execution context is no longer current',
        '请先调用 synapse_observe 获取当前内容和新的 executionContextId。',
      );
    }
    if (
      snapshot.environment.verificationStatus !== 'verified' ||
      snapshot.environment.dialect === 'unknown' ||
      snapshot.environment.platform === 'unknown'
    ) {
      throw new InteractiveCommandExecutorError(
        'SESSION_NOT_READY',
        'current PTY environment is not verified',
        '请先验证当前 PTY environment 后再启动交互事务。',
      );
    }

    let driver: ShellDriver;
    let dispatch: ShellCommandDispatch;
    try {
      driver = resolveShellDriver(snapshot.environment.dialect);
      dispatch = driver.buildInteractiveDispatch(input.command);
    } catch (error) {
      if (error instanceof ShellDriverError) {
        const code = error.code === 'UNSUPPORTED_SHELL' ? 'SHELL_MISMATCH' : error.code;
        throw new InteractiveCommandExecutorError(
          code,
          error.message,
          '请检查当前 PTY environment 和交互 command。',
        );
      }
      throw new InteractiveCommandExecutorError(
        'COMMAND_NOT_AUDITABLE',
        error instanceof Error ? error.message : String(error),
        '请检查输入。',
      );
    }

    const transaction: InteractiveTransaction = {
      id: this.#options.idFactory(),
      sessionId: snapshot.id,
      kind: 'interactive',
      command: input.command,
      nonce: this.#options.nonceFactory(),
      inputGrantId: this.#options.inputGrantIdFactory(),
      inputGrantMode: input.inputGrantMode,
      ...(input.risk === undefined ? {} : { risk: input.risk }),
      ...(input.riskEvidence === undefined
        ? {}
        : { riskEvidence: structuredClone(input.riskEvidence) }),
      status: 'running',
      outputRange: {
        startCursor: this.#readOutputCursor('0'),
        endCursor: this.#readOutputCursor('0'),
      },
      completion: { confirmed: false },
      retryable: false,
      safeToResubmit: false,
    };
    const settled = createDeferred<void>();
    const run: ActiveRun = {
      transaction,
      startDispatch: dispatch,
      driver,
      environmentEpoch: input.expectedEnvironmentEpoch ?? snapshot.environment.capabilityEpoch,
      executionContextIdBeforeStart: input.expectedContextId,
      buffer: new OutputBuffer({ maxBytes: this.#options.outputMaxBytes }),
      listener: () => undefined,
      callerId: input.callerId,
      lease: input.lease,
      grant: {
        id: transaction.inputGrantId,
        mode: input.inputGrantMode,
        callsUsed: 0,
        bytesUsed: 0,
        lastInputAt: Date.now(),
        revoked: false,
      },
      inputRecords: new Map(),
      initialResolved: false,
      sent: false,
      phase: 'starting',
      environmentInvalidated: false,
      waiters: new Set(),
      settledPromise: settled.promise,
      resolveSettled: settled.resolve,
    };
    run.listener = this.#actor.onEvent((event) => this.#handleEvent(run, event));
    this.#active = run;

    const write = await this.#actor.writeInteractiveStart(
      dispatch.payload,
      run.environmentEpoch,
      run.executionContextIdBeforeStart,
      { isCancelled: () => this.#disposed || run.phase === 'settled' },
    );
    if (!write.ok) {
      if (write.error === 'write-unknown') {
        run.environmentInvalidated = true;
        const error = new InteractiveCommandExecutorError(
          'INTERACTIVE_START_WRITE_UNKNOWN',
          'the PTY backend did not confirm delivery of the interactive command',
          '当前 environment 已失效；请先重新 synapse_observe，由用户判断后续动作，不要自动重放。',
        );
        this.#rejectStart(run, error);
        throw error;
      } else {
        const error = startWriteError(write.error);
        this.#rejectStart(run, error);
        throw error;
      }
    }

    run.sent = true;
    run.phase = 'running';
    run.transaction = {
      ...run.transaction,
      outputRange: {
        startCursor: this.#readOutputCursor(run.transaction.outputRange.startCursor),
        endCursor: this.#readOutputCursor(run.transaction.outputRange.startCursor),
      },
    };
    if (
      run.environmentInvalidated ||
      this.#actor.snapshot.pty !== 'running' ||
      this.#actor.snapshot.environment.verificationStatus !== 'verified'
    ) {
      await this.#settle(run, {
        status: 'unknown',
        reason: 'current PTY environment was invalidated immediately after interactive startup',
      });
      return this.#history.get(run.transaction.id)!;
    }
    this.#armIdleTimer(run);
    this.#emit({ type: 'started', transaction: structuredClone(run.transaction) });
    const initial = this.#snapshotResult(run);
    run.initialResolved = true;
    return initial;
  }

  async #input(request: InteractiveInputRequest): Promise<InteractiveExecutionResult> {
    if (this.#disposed) throw this.#expiredError();
    const run = this.#active;
    const callerId = request.callerId ?? run?.callerId;
    const key = this.#inputKey(callerId, request.inputRequestId);
    const payloadHash = request.payload.payloadHash ?? hashInputPayload(request.payload);
    const existing = this.#inputHistory.get(key);
    if (existing !== undefined) {
      if (
        existing.transactionId !== request.transactionId ||
        existing.grantId !== request.inputGrantId ||
        existing.payloadHash !== payloadHash
      ) {
        throw new InteractiveCommandExecutorError(
          'POLICY_DENIED',
          'inputRequestId was already used with a different transaction, payload, or grant',
          '请为新的逻辑输入生成新的 inputRequestId；不确定写入不得自动重放。',
        );
      }
      if (existing.outcome !== undefined || existing.error !== undefined) {
        return this.#cachedInputResult(existing);
      }
      return existing.promise;
    }
    if (run === undefined || run.transaction.id !== request.transactionId) {
      throw this.#transactionNotFound(request.transactionId);
    }
    this.#assertCaller(run, request.callerId);
    if (
      run.environmentInvalidated ||
      this.#actor.snapshot.environment.verificationStatus !== 'verified'
    ) {
      await this.#settle(run, {
        status: 'unknown',
        reason: 'current PTY environment was invalidated before input delivery',
      });
      throw this.#transactionNotFound(request.transactionId);
    }
    if (run.phase !== 'running') {
      throw new InteractiveCommandExecutorError(
        'SESSION_BUSY',
        'interactive transaction is finalizing',
        '请等待当前交互事务收敛。',
      );
    }
    if (run.grant.revoked || run.grant.id !== request.inputGrantId) {
      throw new InteractiveCommandExecutorError(
        'INPUT_GRANT_EXHAUSTED',
        'input grant is missing, expired, or belongs to another transaction',
        '请使用当前交互启动返回的有限 inputGrantId。',
      );
    }
    if (!isValidPayload(request.payload)) {
      throw new InteractiveCommandExecutorError(
        'COMMAND_NOT_AUDITABLE',
        'input payload is empty or exceeds the fixed protocol limits',
        '请调整 text 或 keys 后重试；本次未写入且未消耗授权。',
      );
    }
    if (run.grant.mode === 'one_shot' && run.grant.callsUsed >= 1) {
      throw new InteractiveCommandExecutorError(
        'INPUT_GRANT_EXHAUSTED',
        'one_shot input grant has already been consumed',
        '请结束当前事务并重新启动交互事务。',
      );
    }
    if (
      run.grant.mode === 'bounded' &&
      (run.grant.callsUsed >= BOUNDED_MAX_CALLS ||
        run.grant.bytesUsed + request.payload.payloadBytes > BOUNDED_MAX_BYTES)
    ) {
      throw new InteractiveCommandExecutorError(
        'INPUT_GRANT_EXHAUSTED',
        'bounded input grant quota is exhausted',
        '请结束当前事务；系统不会自动扩展输入授权。',
      );
    }

    const deferred = createDeferred<InteractiveExecutionResult>();
    const record: InputRecord = {
      mode: 'transactional',
      transactionId: request.transactionId,
      grantId: request.inputGrantId,
      payloadHash,
      promise: deferred.promise,
      resolve: deferred.resolve,
      reject: deferred.reject,
    };
    this.#inputHistory.set(key, record);
    run.inputRecords.set(key, record);
    void record.promise.catch(() => undefined);
    run.grant.callsUsed += 1;
    run.grant.bytesUsed += request.payload.payloadBytes;
    run.grant.lastInputAt = Date.now();
    this.#armIdleTimer(run);

    const write = await this.#actor.writeTransactionalInput(request.payload.data, {
      isCancelled: () => this.#disposed || run.phase !== 'running' || run.environmentInvalidated,
    });
    if (!write.ok) {
      const error = inputWriteError(
        write.error,
        run.environmentInvalidated ||
          this.#actor.snapshot.environment.verificationStatus !== 'verified',
      );
      record.error = error;
      record.reject(error);
      record.resolve = () => undefined;
      record.reject = () => undefined;
      if (write.error === 'write-unknown') run.environmentInvalidated = true;
      await this.#settle(run, { status: 'unknown', reason: error.message });
      throw error;
    }

    if (
      run.environmentInvalidated ||
      this.#actor.snapshot.environment.verificationStatus !== 'verified'
    ) {
      const error = inputWriteError('external-write-cancelled', true);
      record.error = error;
      record.reject(error);
      record.resolve = () => undefined;
      record.reject = () => undefined;
      await this.#settle(run, { status: 'unknown', reason: error.message });
      throw error;
    }

    const cursor = this.#readOutputCursor(run.transaction.outputRange.endCursor);
    run.lastInputCursor = cursor;
    const result = this.#snapshotResult(run, false, {
      textLength: request.payload.textLength,
      keys: [...request.payload.keys],
      payloadBytes: request.payload.payloadBytes,
    });
    record.outcome = createInputReplaySummary(result);
    record.promise = Promise.resolve(record.outcome);
    record.resolve(result);
    record.resolve = () => undefined;
    record.reject = () => undefined;
    return result;
  }

  async #sendFinish(run: ActiveRun): Promise<void> {
    const nonce = this.#options.nonceFactory();
    run.finishNonce = nonce;
    run.finishEchoPattern = run.driver.buildCompletionEchoPattern(nonce);
    this.#actor.suppressInputEcho(run.finishEchoPattern);
    const write = await this.#actor.writeInteractiveFinishProbe(
      `${run.driver.buildCompletionProbe(nonce)}\r`,
      {
        isCancelled: () =>
          this.#disposed ||
          run.phase !== 'finishing' ||
          run.environmentInvalidated ||
          this.#actor.snapshot.environment.verificationStatus !== 'verified',
      },
    );
    if (!write.ok) {
      if (write.error === 'write-unknown') run.environmentInvalidated = true;
      await this.#settle(run, {
        status: 'unknown',
        reason: 'finish Probe delivery is not confirmed',
      });
      return;
    }
    run.finishTimer = setTimeout(() => {
      void this.#enqueue(() =>
        this.#settle(run, {
          status: 'unknown',
          reason: 'finish Probe did not produce completion evidence before the deadline',
        }),
      );
    }, this.#options.finishTimeoutMs);
  }

  #handleEvent(run: ActiveRun, event: SessionActorEvent): void {
    if (this.#active !== run || run.phase === 'settled') return;
    if (event.type === 'pty_output') {
      if (run.sent) {
        run.buffer.append(event.sequence, event.historyData ?? event.data);
        if (run.lastInputCursor !== undefined) {
          run.lastInputCursor = this.#readOutputCursor(run.lastInputCursor);
        }
      }
      return;
    }
    if (event.type === 'terminal_output') return;
    if (event.type === 'environment_invalidated') {
      run.environmentInvalidated = true;
      if (
        (run.phase === 'running' || run.phase === 'finishing') &&
        run.completionExitCode === undefined
      ) {
        void this.#enqueue(() =>
          this.#settle(run, {
            status: 'unknown',
            reason: `current PTY environment was invalidated at epoch ${event.capabilityEpoch}`,
          }),
        );
      }
      return;
    }
    if (event.type === 'osc_777') {
      if (run.phase !== 'finishing' || run.finishNonce === undefined) return;
      const completion = run.driver.parseCompletion(event.payload);
      if (completion?.nonce !== run.finishNonce) return;
      run.completionExitCode = completion.exitCode;
      if (this.#options.completionDrainMs === 0) {
        void this.#enqueue(() =>
          this.#settle(run, { status: 'completed', exitCode: completion.exitCode }),
        );
      } else {
        run.completionDrainTimer = setTimeout(() => {
          void this.#enqueue(() =>
            this.#settle(run, { status: 'completed', exitCode: completion.exitCode }),
          );
        }, this.#options.completionDrainMs);
      }
      return;
    }
    if (event.type === 'pty_exit') {
      if (run.phase === 'finishing' && run.completionExitCode !== undefined) {
        void this.#enqueue(() =>
          this.#settle(run, { status: 'completed', exitCode: run.completionExitCode! }),
        );
      } else if (run.phase !== 'starting') {
        void this.#enqueue(() =>
          this.#settle(run, { status: 'unknown', reason: 'PTY exited before completion evidence' }),
        );
      }
    }
  }

  async #settle(
    run: ActiveRun,
    outcome:
      | { status: 'completed'; exitCode: number }
      | { status: 'interrupted' | 'unknown'; reason: string },
  ): Promise<void> {
    if (this.#active !== run || run.phase === 'settled' || run.phase === 'settling') return;
    run.phase = 'settling';
    clearTimeout(run.finishTimer);
    clearTimeout(run.completionDrainTimer);
    clearTimeout(run.idleTimer);
    if (outcome.status !== 'completed') {
      run.transaction = { ...run.transaction, status: outcome.status, reason: outcome.reason };
    }
    const graceMs = outcome.status === 'completed' ? this.#options.completionEchoGraceMs : 0;
    if (run.finishEchoPattern !== undefined) {
      await this.#actor.releaseInputEcho(run.finishEchoPattern, { graceMs }).catch(() => undefined);
    }
    if (!run.environmentInvalidated) {
      await this.#actor.invalidateEnvironment().catch(() => undefined);
      run.environmentInvalidated = true;
    }
    run.phase = 'settled';
    run.grant.revoked = true;
    run.transaction = {
      ...run.transaction,
      ...outcome,
      status: outcome.status,
      outputRange: {
        startCursor: run.transaction.outputRange.startCursor,
        endCursor: this.#readOutputCursor(run.buffer.snapshot().cursor),
      },
      completion:
        outcome.status === 'completed'
          ? { confirmed: true, exitCode: outcome.exitCode }
          : { confirmed: false },
      retryable: false,
      safeToResubmit: false,
    };
    this.#active = undefined;
    const result = this.#snapshotResult(run);
    this.#history.set(run.transaction.id, result);
    this.#emit({ type: 'finished', transaction: structuredClone(run.transaction) });
    if (!run.initialResolved) run.initialResolved = true;
    run.finishResolve?.(result);
    for (const waiter of run.waiters) {
      if (waiter.timer !== undefined) clearTimeout(waiter.timer);
      waiter.resolve(result);
    }
    run.waiters.clear();
    run.finishReject = undefined;
    run.listener();
    run.lease?.release();
    run.resolveSettled();
  }

  #rejectStart(run: ActiveRun, error: InteractiveCommandExecutorError): void {
    if (run.phase === 'settled') return;
    clearTimeout(run.finishTimer);
    clearTimeout(run.completionDrainTimer);
    clearTimeout(run.idleTimer);
    run.phase = 'settled';
    run.grant.revoked = true;
    run.listener();
    if (this.#active === run) this.#active = undefined;
    run.lease?.release();
    run.finishReject?.(error);
    run.resolveSettled();
  }

  #findActive(transactionId: TransactionId): ActiveRun {
    const run = this.#active;
    if (run === undefined || run.transaction.id !== transactionId) {
      throw this.#transactionNotFound(transactionId);
    }
    return run;
  }

  #assertCaller(run: ActiveRun, callerId: string | undefined): void {
    if (run.callerId !== undefined && callerId !== undefined && run.callerId !== callerId) {
      throw new InteractiveCommandExecutorError(
        'TRANSACTION_NOT_FOUND',
        'transaction is not owned by this external caller',
        '请使用当前外部客户端和已共享 Session 的事务句柄。',
      );
    }
  }

  #snapshotResult(
    run: ActiveRun,
    waitTimedOut = false,
    sent?: SentInputMetadata,
  ): InteractiveExecutionResult {
    const output = run.buffer.snapshot();
    const endCursor =
      run.transaction.status === 'running'
        ? this.#readOutputCursor(output.cursor)
        : run.transaction.outputRange.endCursor;
    const outputRange = { startCursor: run.transaction.outputRange.startCursor, endCursor };
    const transaction = structuredClone({ ...run.transaction, outputRange });
    return {
      transaction,
      status: transaction.status,
      output,
      cursor: endCursor,
      nextCursor: endCursor,
      outputRange,
      executionContextId: this.#actor.snapshot.executionContextId,
      completion: structuredClone(transaction.completion),
      retryable: false,
      safeToResubmit: false,
      ...(run.transaction.status === 'running'
        ? { inputGrantId: run.grant.id, inputGrantMode: run.grant.mode }
        : {}),
      ...(sent === undefined ? {} : { sent }),
      ...(waitTimedOut ? { waitTimedOut: true } : {}),
    };
  }

  async #cachedInputResult(record: InputRecord): Promise<InteractiveExecutionResult> {
    if (record.error !== undefined) throw record.error;
    if (record.outcome !== undefined) return structuredClone(record.outcome);
    return record.promise;
  }

  #inputKey(callerId: string | undefined, requestId: InputRequestId): string {
    return `${callerId ?? ''}\u0000${requestId}`;
  }

  #readOutputCursor(fallback: OutputCursor | number): OutputCursor {
    const value = this.#options.outputCursor?.();
    const fallbackCursor = typeof fallback === 'number' ? String(fallback) : fallback;
    return value === undefined || value.length === 0 ? fallbackCursor : value;
  }

  #armIdleTimer(run: ActiveRun): void {
    clearTimeout(run.idleTimer);
    run.idleTimer = setTimeout(() => {
      void this.#enqueue(() => {
        if (this.#active !== run || run.phase !== 'running') return;
        if (Date.now() - run.grant.lastInputAt < this.#options.idleTimeoutMs) {
          this.#armIdleTimer(run);
          return;
        }
        return this.#settle(run, {
          status: 'unknown',
          reason: 'interactive input grant expired after the idle timeout',
        });
      });
    }, this.#options.idleTimeoutMs);
  }

  #enqueue<T>(task: () => T | Promise<T>): Promise<T> {
    const next = this.#queue.then(task, task);
    this.#queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  #expiredError(): InteractiveCommandExecutorError {
    return new InteractiveCommandExecutorError(
      'SESSION_EXPIRED',
      'interactive executor is no longer active',
      '请重新共享 Session 后先观察再启动交互事务。',
    );
  }

  #notReadyError(): InteractiveCommandExecutorError {
    return new InteractiveCommandExecutorError(
      'SESSION_NOT_READY',
      'terminal session is not running',
      '请稍后重试。',
    );
  }

  #transactionNotFound(transactionId: string): InteractiveCommandExecutorError {
    return new InteractiveCommandExecutorError(
      'TRANSACTION_NOT_FOUND',
      `transaction ${transactionId} was not found`,
      '请检查 synapse_start_interactive 返回的事务 ID。',
    );
  }

  #emit(event: InteractiveCommandExecutorEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

/**
 * Keep only the metadata needed for an idempotent replay. The first response can
 * contain the normal output window, but a deduplication record must not retain
 * raw PTY text that could include echoed secrets.
 */
function createInputReplaySummary(result: InteractiveExecutionResult): InteractiveExecutionResult {
  return {
    ...structuredClone(result),
    output: {
      cursor: result.output.cursor,
      text: '',
      head: '',
      tail: '',
      totalBytes: 0,
      truncated: result.output.truncated,
    },
  };
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be non-negative`);
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive`);
}

function normalizeWaitTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  if (!Number.isFinite(value) || value < 0 || value > MAX_WAIT_TIMEOUT_MS) {
    throw new RangeError('timeoutMs must be between 0 and 60000 milliseconds');
  }
  return value;
}

function isValidPayload(payload: InteractiveInputPayload): boolean {
  if (
    typeof payload.data !== 'string' ||
    !Array.isArray(payload.keys) ||
    !payload.keys.every((key) => INPUT_KEY_NAMES.has(key))
  ) {
    return false;
  }
  const normalizedTextBytes =
    payload.normalizedText === undefined
      ? payload.textLength
      : Buffer.byteLength(payload.normalizedText, 'utf8');
  return (
    payload.data.length > 0 &&
    Number.isSafeInteger(payload.textLength) &&
    payload.textLength >= 0 &&
    payload.textLength <= MAX_INPUT_TEXT_BYTES &&
    normalizedTextBytes <= MAX_INPUT_TEXT_BYTES &&
    (payload.normalizedText === undefined || payload.textLength === normalizedTextBytes) &&
    Number.isSafeInteger(payload.payloadBytes) &&
    payload.payloadBytes > 0 &&
    payload.keys.length <= MAX_INPUT_KEYS &&
    Buffer.byteLength(payload.data, 'utf8') <= MAX_INPUT_PAYLOAD_BYTES &&
    payload.payloadBytes === Buffer.byteLength(payload.data, 'utf8')
  );
}

const INPUT_KEY_NAMES = new Set<InputKey>([
  'up',
  'down',
  'right',
  'left',
  'enter',
  'esc',
  'tab',
  'backspace',
  'delete',
  'home',
  'end',
  'pageup',
  'pagedown',
  'space',
  'f1',
  'f2',
  'f3',
  'f4',
  'f5',
  'f6',
  'f7',
  'f8',
  'f9',
  'f10',
  'f11',
  'f12',
]);

function hashInputPayload(payload: InteractiveInputPayload): string {
  return createHash('sha256')
    .update(
      JSON.stringify({ text: payload.normalizedText ?? payload.data, keys: payload.keys }),
      'utf8',
    )
    .digest('hex');
}

function startWriteError(
  error:
    | 'stale-environment-epoch'
    | 'stale-execution-context'
    | 'environment-unverified'
    | 'session-not-running'
    | 'external-write-cancelled',
): InteractiveCommandExecutorError {
  switch (error) {
    case 'stale-execution-context':
      return new InteractiveCommandExecutorError(
        'EXECUTION_CONTEXT_STALE',
        'the execution context changed before the interactive command was written',
        '请先调用 synapse_observe 获取当前内容和新的 executionContextId。',
      );
    case 'stale-environment-epoch':
      return new InteractiveCommandExecutorError(
        'SESSION_NOT_READY',
        'the verified PTY environment changed before the interactive command was written',
        '请重新观察当前 Session 后再启动交互事务。',
      );
    case 'environment-unverified':
      return new InteractiveCommandExecutorError(
        'SESSION_NOT_READY',
        'current PTY environment is not verified',
        '请先验证当前 PTY environment。',
      );
    case 'external-write-cancelled':
      return new InteractiveCommandExecutorError(
        'SESSION_EXPIRED',
        'interactive command dispatch was cancelled before the PTY write',
        '请重新共享 Session 后再试。',
      );
    case 'session-not-running':
      return new InteractiveCommandExecutorError(
        'SESSION_EXPIRED',
        'terminal session is no longer running',
        '请重新共享 Session。',
      );
  }
}

function inputWriteError(
  error: InteractiveInputWriteResult extends infer Result
    ? Result extends { ok: false; error: infer Code }
      ? Code
      : never
    : never,
  environmentInvalidated = false,
): InteractiveCommandExecutorError {
  if (error === 'write-unknown') {
    return new InteractiveCommandExecutorError(
      'INPUT_WRITE_UNKNOWN',
      'the PTY backend did not confirm delivery of the input payload',
      '所属交互事务已进入 unknown；不要使用新的 inputRequestId 自动重放。',
    );
  }
  if (error === 'external-write-cancelled') {
    if (environmentInvalidated) {
      return new InteractiveCommandExecutorError(
        'INPUT_WRITE_UNKNOWN',
        'the PTY environment was invalidated before input delivery was confirmed',
        '所属交互事务已进入 unknown；不要使用新的 inputRequestId 自动重放。',
      );
    }
    return new InteractiveCommandExecutorError(
      'SESSION_EXPIRED',
      'input dispatch was cancelled before the PTY write',
      '请重新共享 Session。',
    );
  }
  return new InteractiveCommandExecutorError(
    'INPUT_WRITE_UNKNOWN',
    'the terminal session stopped before input delivery was confirmed',
    '所属交互事务已进入 unknown；不要自动重放输入。',
  );
}
