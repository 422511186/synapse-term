import { randomUUID } from 'node:crypto';

import type {
  CommandRisk,
  CommandRiskEvidence,
  CompletionMetadata,
  ExecutionContextId,
  ExternalTransactionStatus,
  OutputCursor,
  TransactionOutputRange,
} from '@synapse-term/domain';

import {
  resolveShellDriver,
  ShellDriverError,
  type ShellDispatch,
  type ShellDriver,
} from '../shell/shell-driver.js';
import type { SessionActor, SessionActorEvent } from './session-actor.js';
import { OutputBuffer, type OutputSnapshot } from './output-buffer.js';

export type CommandExecutionStatus = ExternalTransactionStatus;

export interface CommandTransaction {
  id: string;
  sessionId: string;
  kind: 'structured';
  command: string;
  nonce: string;
  risk?: CommandRisk | undefined;
  riskEvidence?: CommandRiskEvidence | undefined;
  status: ExternalTransactionStatus;
  outputRange: TransactionOutputRange;
  completion: CompletionMetadata;
  retryable: boolean;
  safeToResubmit: boolean;
  exitCode?: number | undefined;
  reason?: string | undefined;
}

export interface CommandExecutionResult {
  transaction: CommandTransaction;
  status: ExternalTransactionStatus;
  output: OutputSnapshot;
  cursor: OutputCursor;
  nextCursor: OutputCursor;
  outputRange: TransactionOutputRange;
  executionContextId: ExecutionContextId;
  completion: CompletionMetadata;
  retryable: boolean;
  safeToResubmit: boolean;
  waitTimedOut?: boolean | undefined;
}

export interface ExecuteCommandInput {
  command: string;
  risk?: CommandRisk | undefined;
  riskEvidence?: CommandRiskEvidence | undefined;
  observationWindowMs?: number | undefined;
  expectedContextId?: ExecutionContextId | undefined;
}

export interface WaitCommandInput {
  transactionId: string;
  timeoutMs?: number | undefined;
}

export type CommandExecutorEvent =
  | { type: 'started'; transaction: CommandTransaction }
  | { type: 'finished'; transaction: CommandTransaction };

export class CommandExecutorError extends Error {
  readonly code: string;

  constructor(code: string, message: string, guidance: string) {
    super(`${code}: ${message} ${guidance}`);
    this.name = code;
    this.code = code;
  }
}

interface ActiveRun {
  transaction: CommandTransaction;
  dispatch: ShellDispatch;
  driver: ShellDriver;
  environmentEpoch: number;
  executionContextId: ExecutionContextId;
  buffer: OutputBuffer;
  listener: () => void;
  initialTimer: NodeJS.Timeout;
  completionDrainTimer?: NodeJS.Timeout | undefined;
  completionExitCode?: number | undefined;
  resolveInitial: (result: CommandExecutionResult) => void;
  rejectInitial: (error: unknown) => void;
  waiters: Set<PendingWaiter>;
  settledWaiters: Set<() => void>;
  initialTimerElapsed: boolean;
  initialResolved: boolean;
  sent: boolean;
  captureOutput: boolean;
  finishing: boolean;
  settled: boolean;
  settledPromise: Promise<void>;
  resolveSettled: () => void;
}

interface PendingWaiter {
  resolve: (result: CommandExecutionResult) => void;
  timer?: NodeJS.Timeout | undefined;
}

export interface CommandExecutorOptions {
  idFactory?: () => string;
  nonceFactory?: () => string;
  observationWindowMs?: number;
  completionDrainMs?: number;
  completionEchoGraceMs?: number;
  outputMaxBytes?: number;
  outputCursor?: (() => OutputCursor) | undefined;
}

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const MAX_WAIT_TIMEOUT_MS = 60_000;

export class CommandExecutor {
  readonly #actor: SessionActor;
  readonly #options: {
    idFactory: () => string;
    nonceFactory: () => string;
    observationWindowMs: number;
    completionDrainMs: number;
    completionEchoGraceMs: number;
    outputMaxBytes: number;
    outputCursor: (() => OutputCursor) | undefined;
  };
  readonly #listeners = new Set<(event: CommandExecutorEvent) => void>();
  readonly #history = new Map<string, CommandExecutionResult>();
  #active: ActiveRun | undefined;
  #disposed = false;
  #disposePromise: Promise<void> | undefined;

  constructor(actor: SessionActor, options: CommandExecutorOptions = {}) {
    this.#actor = actor;
    this.#options = {
      idFactory: options.idFactory ?? randomUUID,
      nonceFactory: options.nonceFactory ?? randomUUID,
      observationWindowMs: options.observationWindowMs ?? 750,
      completionDrainMs: options.completionDrainMs ?? 50,
      completionEchoGraceMs: options.completionEchoGraceMs ?? 250,
      outputMaxBytes: options.outputMaxBytes ?? 64 * 1024,
      outputCursor: options.outputCursor,
    };
    if (
      !Number.isFinite(this.#options.observationWindowMs) ||
      this.#options.observationWindowMs < 0
    ) {
      throw new RangeError('observationWindowMs must be a non-negative finite number');
    }
    if (!Number.isFinite(this.#options.completionDrainMs) || this.#options.completionDrainMs < 0) {
      throw new RangeError('completionDrainMs must be a non-negative finite number');
    }
    if (
      !Number.isFinite(this.#options.completionEchoGraceMs) ||
      this.#options.completionEchoGraceMs < 0
    ) {
      throw new RangeError('completionEchoGraceMs must be a non-negative finite number');
    }
    if (!Number.isSafeInteger(this.#options.outputMaxBytes) || this.#options.outputMaxBytes < 1) {
      throw new RangeError('outputMaxBytes must be a positive safe integer');
    }
  }

  get activeTransactionId(): string | undefined {
    return this.#active?.transaction.id;
  }

  onEvent(listener: (event: CommandExecutorEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  execute(commandInput: ExecuteCommandInput | string): Promise<CommandExecutionResult> {
    const input = typeof commandInput === 'string' ? { command: commandInput } : commandInput;
    if (this.#disposed) {
      return Promise.reject(
        new CommandExecutorError(
          'SESSION_EXPIRED',
          'executor is no longer active',
          '请重新共享 Session 后先观察再执行。',
        ),
      );
    }
    const snapshot = this.#actor.snapshot;
    if (snapshot.pty !== 'running') {
      return Promise.reject(
        new CommandExecutorError(
          'SESSION_NOT_READY',
          'terminal session is not running',
          '请稍后重试。',
        ),
      );
    }
    if (this.#active !== undefined) {
      return Promise.reject(
        new CommandExecutorError(
          'SESSION_BUSY',
          'another transaction is active',
          '请先等待或中断。',
        ),
      );
    }
    if (
      input.expectedContextId !== undefined &&
      input.expectedContextId !== snapshot.executionContextId
    ) {
      return Promise.reject(
        new CommandExecutorError(
          'EXECUTION_CONTEXT_STALE',
          'the supplied execution context is no longer current',
          '请先调用 synapse_observe（必要时使用 tail）获取当前终端内容和新的 executionContextId。',
        ),
      );
    }
    if (input.command.trim().length === 0 || input.command.includes('\x00')) {
      return Promise.reject(
        new CommandExecutorError(
          'COMMAND_NOT_AUDITABLE',
          'command is empty or contains an unsupported control character',
          '请检查输入。',
        ),
      );
    }

    if (
      snapshot.environment.verificationStatus !== 'verified' ||
      snapshot.environment.dialect === 'unknown' ||
      snapshot.environment.platform === 'unknown'
    ) {
      return Promise.reject(
        new CommandExecutorError(
          'SESSION_NOT_READY',
          'current PTY environment has not been verified',
          '请等待当前 PTY environment 验证完成后重试。',
        ),
      );
    }

    const startCursor = this.#readOutputCursor('');
    const transaction: CommandTransaction = {
      id: this.#options.idFactory(),
      sessionId: snapshot.id,
      kind: 'structured',
      command: input.command,
      nonce: this.#options.nonceFactory(),
      ...(input.risk === undefined ? {} : { risk: input.risk }),
      ...(input.riskEvidence === undefined
        ? {}
        : { riskEvidence: structuredClone(input.riskEvidence) }),
      status: 'running',
      outputRange: { startCursor, endCursor: startCursor },
      completion: { confirmed: false },
      retryable: false,
      safeToResubmit: false,
    };
    let driver: ShellDriver;
    let dispatch: ShellDispatch;
    try {
      driver = resolveShellDriver(snapshot.environment.dialect);
      dispatch = driver.buildDispatch(transaction.command, transaction.nonce);
    } catch (error) {
      if (error instanceof ShellDriverError) {
        const code = error.code === 'UNSUPPORTED_SHELL' ? 'SHELL_MISMATCH' : error.code;
        return Promise.reject(
          new CommandExecutorError(code, error.message, '请检查当前 PTY environment 和命令。'),
        );
      }
      return Promise.reject(
        new CommandExecutorError(
          'COMMAND_NOT_AUDITABLE',
          error instanceof Error ? error.message : String(error),
          '请检查输入。',
        ),
      );
    }

    let resolveInitial!: (result: CommandExecutionResult) => void;
    let rejectInitial!: (error: unknown) => void;
    const initialPromise = new Promise<CommandExecutionResult>((resolve, reject) => {
      resolveInitial = resolve;
      rejectInitial = reject;
    });
    const run = {} as ActiveRun;
    run.transaction = transaction;
    run.dispatch = dispatch;
    run.driver = driver;
    run.environmentEpoch = snapshot.environment.capabilityEpoch;
    run.executionContextId = snapshot.executionContextId;
    run.buffer = new OutputBuffer({ maxBytes: this.#options.outputMaxBytes });
    run.listener = this.#actor.onEvent((event) => this.#handleEvent(run, event));
    run.initialTimer = setTimeout(() => {
      run.initialTimerElapsed = true;
      if (!run.settled && run.sent) this.#resolveInitial(run, this.#result(run));
    }, input.observationWindowMs ?? this.#options.observationWindowMs);
    run.resolveInitial = resolveInitial;
    run.rejectInitial = rejectInitial;
    run.waiters = new Set();
    run.settledWaiters = new Set();
    let resolveSettled!: () => void;
    run.settledPromise = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    run.resolveSettled = resolveSettled;
    run.initialTimerElapsed = false;
    run.initialResolved = false;
    run.sent = false;
    run.captureOutput = true;
    run.finishing = false;
    run.settled = false;
    this.#active = run;
    void this.#dispatch(run);
    return initialPromise;
  }

  async wait(input: WaitCommandInput): Promise<CommandExecutionResult> {
    const timeoutMs = normalizeWaitTimeout(input.timeoutMs);
    const active = this.#active;
    if (active !== undefined && active.transaction.id === input.transactionId) {
      if (active.settled) return this.#result(active);
      if (timeoutMs === 0) return this.#result(active, true);
      return new Promise((resolve) => {
        const waiter: PendingWaiter = { resolve };
        waiter.timer = setTimeout(() => {
          if (!active.waiters.delete(waiter)) return;
          waiter.resolve(this.#result(active, true));
        }, timeoutMs);
        active.waiters.add(waiter);
      });
    }

    const stored = this.#history.get(input.transactionId);
    if (stored === undefined) {
      throw new CommandExecutorError(
        'TRANSACTION_NOT_FOUND',
        `transaction ${input.transactionId} was not found`,
        '请检查 synapse_execute 返回的事务 ID。',
      );
    }
    return structuredClone(stored);
  }

  get(transactionId: string): CommandExecutionResult | undefined {
    if (this.#active?.transaction.id === transactionId) return this.#result(this.#active);
    return structuredClone(this.#history.get(transactionId));
  }

  async interrupt(transactionId: string): Promise<boolean> {
    const active = this.#active;
    if (active === undefined || active.transaction.id !== transactionId || active.settled) {
      return false;
    }
    if (!active.sent) return false;
    if (active.completionExitCode === undefined) {
      try {
        await this.#actor.interrupt();
      } catch (error) {
        this.#finish(active, {
          status: 'unknown',
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (!active.settled && !active.finishing) {
      if (active.completionExitCode !== undefined) {
        this.#finish(active, { status: 'completed', exitCode: active.completionExitCode });
      } else {
        this.#finish(active, {
          status: 'interrupted',
          reason: 'PTY interrupt requested; remote process termination is not confirmed',
        });
      }
    }
    if (!active.settled) {
      await new Promise<void>((resolve) => active.settledWaiters.add(resolve));
    }
    return true;
  }

  dispose(): Promise<void> {
    if (this.#disposePromise !== undefined) return this.#disposePromise;
    this.#disposed = true;
    const active = this.#active;
    if (active !== undefined && !active.settled) {
      if (active.sent) {
        this.#finish(active, {
          status: 'unknown',
          reason: 'executor disposed before completion evidence',
        });
      } else {
        this.#rejectBeforeSend(
          active,
          new CommandExecutorError(
            'SESSION_EXPIRED',
            'executor disposed before the command was written',
            '请重新共享 Session 后先观察再执行。',
          ),
        );
      }
    }
    this.#listeners.clear();
    this.#disposePromise = active?.settledPromise ?? Promise.resolve();
    return this.#disposePromise;
  }

  async #dispatch(run: ActiveRun): Promise<void> {
    if (run.settled) return;
    try {
      this.#actor.suppressInputEcho(run.dispatch.echoPattern);
      if (run.settled) return;
      const write = await this.#actor.writeExternal(
        run.dispatch.payload,
        run.environmentEpoch,
        run.executionContextId,
        { isCancelled: () => run.settled },
      );
      if (run.settled) return;
      if (!write.ok) {
        this.#rejectBeforeSend(run, writeError(write.error));
        return;
      }
      const startCursor = this.#readOutputCursor(run.transaction.outputRange.startCursor);
      run.transaction = {
        ...run.transaction,
        outputRange: { startCursor, endCursor: startCursor },
      };
      run.sent = true;
      this.#emit({ type: 'started', transaction: structuredClone(run.transaction) });
      if (run.initialTimerElapsed && !run.settled) {
        this.#resolveInitial(run, this.#result(run));
      }
    } catch (error) {
      if (run.settled) return;
      if (!run.sent) {
        this.#rejectBeforeSend(
          run,
          new CommandExecutorError(
            'SESSION_NOT_READY',
            error instanceof Error ? error.message : String(error),
            '请确认当前 Session 仍在运行后重试。',
          ),
        );
      } else {
        this.#finish(run, {
          status: 'unknown',
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  #handleEvent(run: ActiveRun, event: SessionActorEvent): void {
    if (run.settled) return;
    if (event.type === 'pty_output') {
      if (run.sent && run.captureOutput) {
        run.buffer.append(event.sequence, event.historyData ?? event.data);
      }
      return;
    }
    if (event.type === 'terminal_output') return;
    if (event.type === 'environment_invalidated') {
      if (!run.sent || run.completionExitCode !== undefined) return;
      this.#finish(run, {
        status: 'unknown',
        reason: `current PTY environment was invalidated at epoch ${event.capabilityEpoch}`,
      });
      return;
    }
    if (event.type === 'osc_777') {
      if (!run.sent) return;
      const completion = run.driver.parseCompletion(event.payload);
      if (completion?.nonce === run.transaction.nonce) {
        run.completionExitCode = completion.exitCode;
        if (this.#options.completionDrainMs === 0) {
          this.#finish(run, { status: 'completed', exitCode: completion.exitCode });
        } else {
          run.completionDrainTimer = setTimeout(
            () => this.#finish(run, { status: 'completed', exitCode: completion.exitCode }),
            this.#options.completionDrainMs,
          );
        }
      }
      return;
    }
    if (event.type === 'pty_exit') {
      if (!run.sent) return;
      if (run.completionExitCode !== undefined) {
        this.#finish(run, { status: 'completed', exitCode: run.completionExitCode });
      } else {
        this.#finish(run, {
          status: 'unknown',
          reason: 'PTY exited before completion evidence',
        });
      }
    }
  }

  #finish(
    run: ActiveRun,
    outcome:
      | { status: 'completed'; exitCode: number }
      | { status: 'interrupted' | 'unknown'; reason: string },
  ): void {
    if (run.settled || run.finishing || !run.sent) return;
    run.finishing = true;
    if (outcome.status !== 'completed') run.captureOutput = false;
    const graceMs = outcome.status === 'completed' ? this.#options.completionEchoGraceMs : 0;
    clearTimeout(run.initialTimer);
    clearTimeout(run.completionDrainTimer);
    void this.#actor
      .releaseInputEcho(run.dispatch.echoPattern, { graceMs })
      .then(() => this.#commitFinish(run, outcome))
      .catch((error: unknown) => {
        this.#commitFinish(run, {
          status: 'unknown',
          reason: error instanceof Error ? error.message : String(error),
        });
      });
  }

  #commitFinish(
    run: ActiveRun,
    outcome:
      | { status: 'completed'; exitCode: number }
      | { status: 'interrupted' | 'unknown'; reason: string },
  ): void {
    if (run.settled) return;
    run.settled = true;
    clearTimeout(run.initialTimer);
    clearTimeout(run.completionDrainTimer);
    run.listener();
    const endCursor = this.#readOutputCursor(run.buffer.snapshot().cursor);
    const completion: CompletionMetadata =
      outcome.status === 'completed'
        ? { confirmed: true, exitCode: outcome.exitCode }
        : { confirmed: false };
    const finished: CommandTransaction = {
      ...run.transaction,
      ...outcome,
      outputRange: { startCursor: run.transaction.outputRange.startCursor, endCursor },
      completion,
      retryable: false,
      safeToResubmit: false,
    };
    run.transaction = finished;
    this.#active = undefined;
    const result = this.#snapshotResult(run, finished);
    this.#history.set(finished.id, result);
    this.#emit({ type: 'finished', transaction: structuredClone(finished) });
    this.#resolveInitial(run, result);
    for (const waiter of run.waiters) {
      if (waiter.timer !== undefined) clearTimeout(waiter.timer);
      run.waiters.delete(waiter);
      waiter.resolve(result);
    }
    for (const resolve of run.settledWaiters) resolve();
    run.settledWaiters.clear();
    run.resolveSettled();
  }

  #rejectBeforeSend(run: ActiveRun, error: CommandExecutorError): void {
    if (run.settled) return;
    run.settled = true;
    clearTimeout(run.initialTimer);
    clearTimeout(run.completionDrainTimer);
    run.listener();
    if (this.#active === run) this.#active = undefined;
    void this.#actor.releaseInputEcho(run.dispatch.echoPattern).finally(() => {
      for (const resolve of run.settledWaiters) resolve();
      run.settledWaiters.clear();
      run.rejectInitial(error);
      run.resolveSettled();
    });
  }

  #result(run: ActiveRun, waitTimedOut = false): CommandExecutionResult {
    return this.#snapshotResult(run, run.transaction, waitTimedOut);
  }

  #resolveInitial(run: ActiveRun, result: CommandExecutionResult): void {
    if (run.initialResolved) return;
    run.initialResolved = true;
    run.resolveInitial(result);
  }

  #snapshotResult(
    run: ActiveRun,
    transaction: CommandTransaction,
    waitTimedOut = false,
  ): CommandExecutionResult {
    const output = run.buffer.snapshot();
    const endCursor =
      transaction.status === 'running'
        ? this.#readOutputCursor(output.cursor)
        : transaction.outputRange.endCursor;
    const outputRange = { startCursor: transaction.outputRange.startCursor, endCursor };
    const transactionSnapshot = structuredClone({ ...transaction, outputRange });
    return {
      transaction: transactionSnapshot,
      status: transactionSnapshot.status,
      output,
      cursor: endCursor,
      nextCursor: endCursor,
      outputRange,
      executionContextId: this.#actor.snapshot.executionContextId,
      completion: structuredClone(transactionSnapshot.completion),
      retryable: transactionSnapshot.retryable,
      safeToResubmit: transactionSnapshot.safeToResubmit,
      ...(waitTimedOut ? { waitTimedOut: true } : {}),
    };
  }

  #readOutputCursor(fallback: OutputCursor | number): OutputCursor {
    const value = this.#options.outputCursor?.();
    const fallbackCursor = typeof fallback === 'number' ? String(fallback) : fallback;
    return value === undefined || typeof value !== 'string' || value.length === 0
      ? fallbackCursor
      : value;
  }

  #emit(event: CommandExecutorEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}

function normalizeWaitTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  if (!Number.isFinite(value) || value < 0 || value > MAX_WAIT_TIMEOUT_MS) {
    throw new RangeError('timeoutMs must be between 0 and 60000 milliseconds');
  }
  return value;
}

function writeError(
  error:
    | 'stale-environment-epoch'
    | 'stale-execution-context'
    | 'environment-unverified'
    | 'session-not-running'
    | 'external-write-cancelled',
): CommandExecutorError {
  switch (error) {
    case 'stale-execution-context':
      return new CommandExecutorError(
        'EXECUTION_CONTEXT_STALE',
        'the execution context changed before the command was written',
        '请先调用 synapse_observe（必要时使用 tail）获取当前终端内容和新的 executionContextId。',
      );
    case 'stale-environment-epoch':
      return new CommandExecutorError(
        'SESSION_NOT_READY',
        'the verified PTY environment changed before the command was written',
        '请重新观察当前 Session，等待 environment 验证后再执行。',
      );
    case 'environment-unverified':
      return new CommandExecutorError(
        'SESSION_NOT_READY',
        'current PTY environment is not verified',
        '请等待当前 PTY environment 验证完成后重试。',
      );
    case 'session-not-running':
      return new CommandExecutorError(
        'SESSION_EXPIRED',
        'terminal session is no longer running',
        '请重新共享该 Session。',
      );
    case 'external-write-cancelled':
      return new CommandExecutorError(
        'SESSION_EXPIRED',
        'external command dispatch was cancelled before the PTY write',
        '请重新共享 Session 后先观察再执行。',
      );
  }
}
