import { randomUUID } from 'node:crypto';

import {
  createCommandTransaction,
  transitionCommandTransaction,
  type CommandRisk,
  type CommandTransaction,
  type CommandTransactionStatus,
} from '@terminal-agent/domain';

import { CommandOutputCollector, type CommandOutputSnapshot } from './command-output-collector.js';
import { InteractionDetector, type InteractionSignal } from './interaction-detector.js';
import type { PtyDisposable } from './pty-adapter.js';
import type { SessionActor } from './session-actor.js';
import { type SessionActorEvent } from './session-actor.js';
import {
  resolveShellDriver,
  SHELL_OUTPUT_START_PAYLOAD,
  type ShellDriver,
} from './shell-driver.js';
import { PlaintextShellDispatcher, type PlaintextDispatchInput } from './plaintext-dispatcher.js';

export interface ExecutorScheduler {
  schedule(callback: () => void, delayMs: number): PtyDisposable;
}

export interface CommandExecutorOptions {
  scheduler?: ExecutorScheduler;
  observationWindowMs?: number;
  hardDeadlineMs?: number;
  outputMaxBytes?: number;
  nonceFactory?: () => string;
  idFactory?: () => string;
  detectorFactory?: () => InteractionDetector;
}

export interface ExecuteCommandInput {
  transactionId?: string;
  taskId: string;
  leaseEpoch: number;
  command: string;
  toolCallId?: string;
  risk?: CommandRisk;
  approvalGrantId?: string;
  observationWindowMs?: number;
}

export interface WaitCommandInput {
  transactionId: string;
  afterCursor?: number;
  timeoutMs?: number;
}

export type CommandExecutionStatus = Extract<
  CommandTransactionStatus,
  'running' | 'completed' | 'interaction_required' | 'interrupted' | 'shell_lost' | 'protocol_error'
>;

export interface CommandExecutionResult {
  status: CommandExecutionStatus;
  transaction: CommandTransaction;
  output: CommandOutputSnapshot;
  cursor: number;
  deadlineExceeded: boolean;
  transportMode?: string | undefined;
  commandHash?: string | undefined;
}

export type CommandExecutorEvent =
  | { type: 'output'; transactionId: string; output: CommandOutputSnapshot }
  | { type: 'hard_deadline'; transactionId: string }
  | { type: 'interaction'; transactionId: string; signal: InteractionSignal }
  | { type: 'transaction'; transaction: CommandTransaction };

export type CommandExecutorErrorCode =
  | 'command_transaction_conflict'
  | 'session_not_ready'
  | 'stale_lease_epoch'
  | 'lease_not_owned'
  | 'transaction_not_found'
  | 'execution_environment_unverified'
  | 'command_not_auditable'
  | 'plaintext_protocol_error';

export class CommandExecutorError extends Error {
  readonly code: CommandExecutorErrorCode;

  constructor(code: CommandExecutorErrorCode, message: string) {
    super(message);
    this.name = 'CommandExecutorError';
    this.code = code;
  }
}

interface Waiter {
  afterCursor: number;
  untilTerminal: boolean;
  resolve: (result: CommandExecutionResult) => void;
  timer?: PtyDisposable | undefined;
}

interface ActiveRun {
  transaction: CommandTransaction;
  driver: ShellDriver;
  captureStarted: boolean;
  collector: CommandOutputCollector;
  detector: InteractionDetector;
  initialPromise: Promise<CommandExecutionResult>;
  initialResolve: (result: CommandExecutionResult) => void;
  initialReturned: boolean;
  finalPromise: Promise<CommandExecutionResult>;
  finalResolve: (result: CommandExecutionResult) => void;
  settled: boolean;
  deadlineExceeded: boolean;
  listener: PtyDisposable;
  observationTimer: PtyDisposable;
  deadlineTimer?: PtyDisposable | undefined;
  waiters: Set<Waiter>;
  transportMode?: string;
  commandHash?: string;
}

const systemScheduler: ExecutorScheduler = {
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    return { dispose: () => clearTimeout(timer) };
  },
};

export class CommandExecutor {
  readonly #actor: SessionActor;
  readonly #dispatcher: PlaintextShellDispatcher;
  readonly #scheduler: ExecutorScheduler;
  readonly #observationWindowMs: number;
  readonly #hardDeadlineMs: number | undefined;
  readonly #outputMaxBytes: number;
  readonly #nonceFactory: () => string;
  readonly #idFactory: () => string;
  readonly #detectorFactory: () => InteractionDetector;
  readonly #transactions = new Map<string, CommandTransaction>();
  readonly #results = new Map<string, CommandExecutionResult>();
  readonly #listeners = new Set<(event: CommandExecutorEvent) => void>();
  #activeId: string | undefined;
  #active: ActiveRun | undefined;

  constructor(actor: SessionActor, options: CommandExecutorOptions = {}) {
    this.#actor = actor;
    this.#dispatcher = new PlaintextShellDispatcher(actor);
    this.#scheduler = options.scheduler ?? systemScheduler;
    this.#observationWindowMs = options.observationWindowMs ?? 750;
    this.#hardDeadlineMs = options.hardDeadlineMs;
    this.#outputMaxBytes = options.outputMaxBytes ?? 64 * 1024;
    this.#nonceFactory = options.nonceFactory ?? randomUUID;
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#detectorFactory = options.detectorFactory ?? (() => new InteractionDetector());
    if (!Number.isFinite(this.#observationWindowMs) || this.#observationWindowMs <= 0) {
      throw new RangeError('observationWindowMs must be a positive finite number');
    }
    if (
      this.#hardDeadlineMs !== undefined &&
      (!Number.isFinite(this.#hardDeadlineMs) || this.#hardDeadlineMs <= 0)
    ) {
      throw new RangeError('hardDeadlineMs must be a positive finite number');
    }
  }

  get activeTransactionId(): string | undefined {
    return this.#activeId;
  }

  execute(input: ExecuteCommandInput): Promise<CommandExecutionResult> {
    const transactionId = input.transactionId ?? this.#idFactory();
    if (this.#activeId !== undefined || this.#transactions.has(transactionId)) {
      return Promise.reject(
        new CommandExecutorError(
          'command_transaction_conflict',
          'a Command Transaction is already active for this Session',
        ),
      );
    }

    const snapshot = this.#actor.snapshot;
    if (snapshot.pty !== 'running' || snapshot.shell !== 'ready') {
      return Promise.reject(
        new CommandExecutorError('session_not_ready', 'Session shell is not ready'),
      );
    }
    if (snapshot.lease.epoch !== input.leaseEpoch) {
      return Promise.reject(
        new CommandExecutorError('stale_lease_epoch', 'agent lease epoch is stale'),
      );
    }
    if (snapshot.lease.owner.kind !== 'agent' || snapshot.lease.owner.taskId !== input.taskId) {
      return Promise.reject(
        new CommandExecutorError('lease_not_owned', 'agent does not own the Session lease'),
      );
    }

    const transaction = createCommandTransaction({
      id: transactionId,
      sessionId: snapshot.id,
      taskId: input.taskId,
      command: input.command,
      nonce: this.#nonceFactory(),
      ...(input.toolCallId === undefined ? {} : { toolCallId: input.toolCallId }),
    });

    const dispatchInput: PlaintextDispatchInput = {
      sessionId: snapshot.id,
      taskId: input.taskId,
      leaseEpoch: input.leaseEpoch,
      command: input.command,
      nonce: transaction.nonce,
      dialect: snapshot.executionDialect,
      platform: snapshot.environment.platform,
      environmentEpoch: snapshot.environment.capabilityEpoch,
      sourceKind: 'plaintext_shell',
      ...(input.approvalGrantId === undefined ? {} : { approvalGrantId: input.approvalGrantId }),
    };

    const prepared = this.#dispatcher.prepare(dispatchInput);
    if (!prepared.ok) {
      return Promise.reject(new CommandExecutorError(prepared.errorCode, prepared.message));
    }

    const driver = resolveShellDriver(snapshot.executionDialect);
    this.#transactions.set(transaction.id, transaction);
    this.#activeId = transaction.id;
    void this.#start(
      transaction,
      input,
      driver,
      dispatchInput,
      prepared.transportMode,
      prepared.commandHash,
    );
    return (
      this.#active?.initialPromise ??
      Promise.resolve(
        this.#resultForTransaction(this.#transactions.get(transaction.id) ?? transaction),
      )
    );
  }

  wait(input: WaitCommandInput): Promise<CommandExecutionResult> {
    const run = this.#active?.transaction.id === input.transactionId ? this.#active : undefined;
    if (run === undefined) {
      const transaction = this.#transactions.get(input.transactionId);
      if (transaction === undefined) {
        return Promise.reject(
          new CommandExecutorError('transaction_not_found', 'Command Transaction not found'),
        );
      }
      return Promise.resolve(this.#resultForTransaction(transaction));
    }

    const current = this.#result(run);
    if (run.settled) return Promise.resolve(current);
    const untilTerminal = input.afterCursor === undefined;
    const afterCursor = input.afterCursor ?? current.cursor;
    if (!untilTerminal && current.cursor > afterCursor) return Promise.resolve(current);

    return new Promise<CommandExecutionResult>((resolve) => {
      const waiter: Waiter = { afterCursor, untilTerminal, resolve };
      const timeoutMs = input.timeoutMs ?? this.#observationWindowMs;
      if (timeoutMs > 0) {
        waiter.timer = this.#scheduler.schedule(() => {
          run.waiters.delete(waiter);
          resolve(this.#result(run));
        }, timeoutMs);
      }
      run.waiters.add(waiter);
    });
  }

  async interrupt(transactionId: string): Promise<boolean> {
    const run = this.#active?.transaction.id === transactionId ? this.#active : undefined;
    if (run === undefined || run.settled) return false;
    await this.#actor.interrupt();
    this.#finish(run, { status: 'interrupted', reason: 'user requested interrupt' });
    return true;
  }

  get(transactionId: string): CommandExecutionResult | undefined {
    const run = this.#active?.transaction.id === transactionId ? this.#active : undefined;
    if (run !== undefined) return this.#result(run);
    const transaction = this.#transactions.get(transactionId);
    return transaction === undefined ? undefined : this.#resultForTransaction(transaction);
  }

  onEvent(listener: (event: CommandExecutorEvent) => void): PtyDisposable {
    this.#listeners.add(listener);
    return { dispose: () => this.#listeners.delete(listener) };
  }

  async #start(
    transaction: CommandTransaction,
    input: ExecuteCommandInput,
    driver: ShellDriver,
    dispatchInput: PlaintextDispatchInput,
    transportMode: string,
    commandHash: string,
  ): Promise<void> {
    let current = transaction;
    let run: ActiveRun | undefined;
    try {
      current = this.#apply(current, {
        status: 'policy_checked',
        risk: input.risk ?? 'unknown',
      });
      current = this.#apply(current, {
        status: 'lease_acquired',
        leaseEpoch: input.leaseEpoch,
        ...(input.approvalGrantId === undefined ? {} : { approvalGrantId: input.approvalGrantId }),
      });
      current = this.#apply(current, { status: 'dispatched' });
      current = this.#apply(current, { status: 'running' });

      let initialResolve!: (result: CommandExecutionResult) => void;
      let finalResolve!: (result: CommandExecutionResult) => void;
      const initialPromise = new Promise<CommandExecutionResult>((resolve) => {
        initialResolve = resolve;
      });
      const finalPromise = new Promise<CommandExecutionResult>((resolve) => {
        finalResolve = resolve;
      });
      const activeRun = {} as ActiveRun;
      run = activeRun;
      activeRun.transaction = current;
      activeRun.driver = driver;
      activeRun.captureStarted = false;
      activeRun.collector = new CommandOutputCollector({ maxBytes: this.#outputMaxBytes });
      activeRun.detector = this.#detectorFactory();
      activeRun.initialPromise = initialPromise;
      activeRun.initialResolve = initialResolve;
      activeRun.initialReturned = false;
      activeRun.finalPromise = finalPromise;
      activeRun.finalResolve = finalResolve;
      activeRun.settled = false;
      activeRun.deadlineExceeded = false;
      activeRun.waiters = new Set();
      activeRun.transportMode = transportMode;
      activeRun.commandHash = commandHash;
      activeRun.listener = this.#actor.onEvent((event) => this.#handleEvent(activeRun, event));
      activeRun.observationTimer = { dispose: () => undefined };
      this.#active = activeRun;
      this.#activeId = current.id;

      await this.#actor.transitionShell('executing');

      activeRun.observationTimer = this.#scheduler.schedule(() => {
        if (activeRun.settled || activeRun.initialReturned) return;
        activeRun.initialReturned = true;
        activeRun.initialResolve(this.#result(activeRun));
      }, input.observationWindowMs ?? this.#observationWindowMs);
      if (this.#hardDeadlineMs !== undefined) {
        activeRun.deadlineTimer = this.#scheduler.schedule(() => {
          if (activeRun.settled) return;
          activeRun.deadlineExceeded = true;
          this.#emit({ type: 'hard_deadline', transactionId: activeRun.transaction.id });
        }, this.#hardDeadlineMs);
      }

      const dispatched = await this.#dispatcher.execute(dispatchInput);
      if (!dispatched.ok) {
        this.#finish(activeRun, {
          status: 'protocol_error',
          reason: `Plaintext dispatch rejected: ${dispatched.errorCode}`,
        });
        return;
      }
      if (!dispatched.writeResult.ok) {
        this.#finish(activeRun, {
          status: 'protocol_error',
          reason: `PTY write rejected: ${dispatched.writeResult.error}`,
        });
        return;
      }
    } catch (error) {
      this.#transactions.set(current.id, current);
      this.#activeId = undefined;
      const result = this.#resultForTransaction(current);
      if (run !== undefined && !run.settled) {
        this.#finish(run, {
          status: 'protocol_error',
          reason: error instanceof Error ? error.message : 'command setup failed',
        });
      }
      if (run === undefined) {
        this.#transactions.set(current.id, {
          ...current,
          status: 'protocol_error',
          reason: error instanceof Error ? error.message : 'command setup failed',
          revision: current.revision + 1,
        });
      }
      void result;
    }
  }

  #handleEvent(run: ActiveRun, event: SessionActorEvent): void {
    if (run.settled) return;
    if (event.type === 'pty_output') {
      if (!run.captureStarted) return;
      run.collector.append(event.sequence, event.data);
      const signal = run.detector.feed(event.data);
      this.#emit({
        type: 'output',
        transactionId: run.transaction.id,
        output: run.collector.snapshot(),
      });
      this.#notifyWaiters(run);
      if (signal !== null) {
        this.#emit({ type: 'interaction', transactionId: run.transaction.id, signal });
        this.#finish(run, { status: 'interaction_required', reason: signal.kind });
      }
      return;
    }
    if (event.type === 'pty_exit') {
      this.#finish(run, { status: 'shell_lost', reason: 'PTY exited before completion frame' });
      return;
    }

    if (event.payload === SHELL_OUTPUT_START_PAYLOAD) {
      run.captureStarted = true;
      return;
    }

    const completion = run.driver.parseCompletion(event.payload);
    if (completion === null) return;
    if (completion.nonce !== run.transaction.nonce) return;
    if (
      completion.exitCode < Number.MIN_SAFE_INTEGER ||
      completion.exitCode > Number.MAX_SAFE_INTEGER
    ) {
      this.#finish(run, { status: 'protocol_error', reason: 'completion exit code out of range' });
      return;
    }
    this.#finish(run, { status: 'completed', exitCode: completion.exitCode });
  }

  #finish(
    run: ActiveRun,
    outcome:
      | { status: 'completed'; exitCode: number }
      | { status: Exclude<CommandExecutionStatus, 'running' | 'completed'>; reason: string },
  ): void {
    if (run.settled) return;
    run.settled = true;
    run.observationTimer.dispose();
    run.deadlineTimer?.dispose();
    run.listener.dispose();

    let next: CommandTransaction;
    if (outcome.status === 'completed') {
      next = this.#apply(run.transaction, { status: 'completed', exitCode: outcome.exitCode });
      run.transaction = next;
      this.#transactions.set(next.id, next);
      void this.#actor
        .transitionShell('ready')
        .catch(() => undefined)
        .then(() => this.#settle(run));
      return;
    } else {
      next = this.#apply(run.transaction, { status: outcome.status, reason: outcome.reason });
      if (outcome.status === 'interaction_required' || outcome.status === 'interrupted') {
        void this.#actor.takeoverUser();
      }
    }
    run.transaction = next;
    this.#transactions.set(next.id, next);
    this.#settle(run);
  }

  #settle(run: ActiveRun): void {
    this.#active = undefined;
    this.#activeId = undefined;
    this.#emit({ type: 'transaction', transaction: run.transaction });
    const result = this.#result(run);
    this.#results.set(run.transaction.id, result);
    if (!run.initialReturned) {
      run.initialReturned = true;
      run.initialResolve(result);
    }
    run.finalResolve(result);
    for (const waiter of run.waiters) {
      waiter.timer?.dispose();
      waiter.resolve(result);
    }
    run.waiters.clear();
  }

  #notifyWaiters(run: ActiveRun): void {
    if (run.settled) return;
    const result = this.#result(run);
    for (const waiter of [...run.waiters]) {
      if (waiter.untilTerminal || result.cursor <= waiter.afterCursor) continue;
      run.waiters.delete(waiter);
      waiter.timer?.dispose();
      waiter.resolve(result);
    }
  }

  #result(run: ActiveRun): CommandExecutionResult {
    const output = run.collector.snapshot();
    return {
      status: run.settled ? (run.transaction.status as CommandExecutionStatus) : 'running',
      transaction: structuredClone(run.transaction),
      output,
      cursor: output.cursor,
      deadlineExceeded: run.deadlineExceeded,
      transportMode: run.transportMode,
      commandHash: run.commandHash,
    };
  }

  #resultForTransaction(transaction: CommandTransaction): CommandExecutionResult {
    const stored = this.#results.get(transaction.id);
    if (stored !== undefined) return structuredClone(stored);
    return {
      status: transaction.status as CommandExecutionStatus,
      transaction: structuredClone(transaction),
      output: {
        cursor: 0,
        text: '',
        head: '',
        tail: '',
        totalBytes: 0,
        truncated: false,
      },
      cursor: 0,
      deadlineExceeded: false,
    };
  }

  #apply(
    transaction: CommandTransaction,
    transition: Parameters<typeof transitionCommandTransaction>[1],
  ): CommandTransaction {
    const result = transitionCommandTransaction(transaction, transition);
    if (!result.ok) throw new Error(result.error);
    this.#transactions.set(result.value.id, result.value);
    this.#emit({ type: 'transaction', transaction: result.value });
    return result.value;
  }

  #emit(event: CommandExecutorEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
