import { randomUUID } from 'node:crypto';

import type { CommandRisk } from '@synapse-term/domain';

import {
  resolveShellDriver,
  ShellDriverError,
  type ShellDispatch,
  type ShellDriver,
} from '../shell/shell-driver.js';
import type { SessionActor, SessionActorEvent } from './session-actor.js';
import { OutputBuffer, type OutputSnapshot } from './output-buffer.js';

export type CommandExecutionStatus =
  'running' | 'completed' | 'interrupted' | 'shell_lost' | 'protocol_error';

export interface CommandTransaction {
  id: string;
  sessionId: string;
  command: string;
  nonce: string;
  risk?: CommandRisk | undefined;
  status: CommandExecutionStatus;
  exitCode?: number | undefined;
  reason?: string | undefined;
}

export interface CommandExecutionResult {
  transaction: CommandTransaction;
  status: CommandExecutionStatus;
  output: OutputSnapshot;
  cursor: number;
}

export interface ExecuteCommandInput {
  command: string;
  risk?: CommandRisk | undefined;
  observationWindowMs?: number | undefined;
}

export interface WaitCommandInput {
  transactionId: string;
  timeoutMs?: number | undefined;
}

export type CommandExecutorEvent =
  | { type: 'started'; transaction: CommandTransaction }
  | { type: 'finished'; transaction: CommandTransaction };

export class CommandExecutorError extends Error {
  constructor(code: string, message: string, guidance: string) {
    super(`${code}: ${message} ${guidance}`);
    this.name = code;
  }
}

interface ActiveRun {
  transaction: CommandTransaction;
  dispatch: ShellDispatch;
  driver: ShellDriver;
  environmentEpoch: number;
  buffer: OutputBuffer;
  listener: () => void;
  initialTimer: NodeJS.Timeout;
  completionDrainTimer?: NodeJS.Timeout | undefined;
  completionExitCode?: number | undefined;
  resolveInitial: (result: CommandExecutionResult) => void;
  waiters: Set<(result: CommandExecutionResult) => void>;
  finishing: boolean;
  settled: boolean;
}

export interface CommandExecutorOptions {
  idFactory?: () => string;
  nonceFactory?: () => string;
  observationWindowMs?: number;
  completionDrainMs?: number;
  completionEchoGraceMs?: number;
  outputMaxBytes?: number;
}

export class CommandExecutor {
  readonly #actor: SessionActor;
  readonly #options: Required<CommandExecutorOptions>;
  readonly #listeners = new Set<(event: CommandExecutorEvent) => void>();
  readonly #history = new Map<string, CommandExecutionResult>();
  #active: ActiveRun | undefined;

  constructor(actor: SessionActor, options: CommandExecutorOptions = {}) {
    this.#actor = actor;
    this.#options = {
      idFactory: options.idFactory ?? randomUUID,
      nonceFactory: options.nonceFactory ?? randomUUID,
      observationWindowMs: options.observationWindowMs ?? 750,
      completionDrainMs: options.completionDrainMs ?? 50,
      completionEchoGraceMs: options.completionEchoGraceMs ?? 250,
      outputMaxBytes: options.outputMaxBytes ?? 64 * 1024,
    };
    if (!Number.isFinite(this.#options.completionDrainMs) || this.#options.completionDrainMs < 0) {
      throw new RangeError('completionDrainMs must be a non-negative finite number');
    }
    if (
      !Number.isFinite(this.#options.completionEchoGraceMs) ||
      this.#options.completionEchoGraceMs < 0
    ) {
      throw new RangeError('completionEchoGraceMs must be a non-negative finite number');
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
          'EXECUTION_ENVIRONMENT_UNVERIFIED',
          'current PTY environment has not been verified',
          '请先等待当前 Shell 环境探针完成后重试。',
        ),
      );
    }

    const transaction: CommandTransaction = {
      id: this.#options.idFactory(),
      sessionId: snapshot.id,
      command: input.command,
      nonce: this.#options.nonceFactory(),
      ...(input.risk === undefined ? {} : { risk: input.risk }),
      status: 'running',
    };
    let driver: ShellDriver;
    let dispatch: ShellDispatch;
    try {
      driver = resolveShellDriver(snapshot.environment.dialect);
      dispatch = driver.buildDispatch(transaction.command, transaction.nonce);
    } catch (error) {
      if (error instanceof ShellDriverError) {
        return Promise.reject(
          new CommandExecutorError(error.code, error.message, '请检查目标 Shell。'),
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
    const initialPromise = new Promise<CommandExecutionResult>((resolve) => {
      resolveInitial = resolve;
    });
    const run: ActiveRun = {
      transaction,
      dispatch,
      driver,
      environmentEpoch: snapshot.environment.capabilityEpoch,
      buffer: new OutputBuffer({ maxBytes: this.#options.outputMaxBytes }),
      listener: this.#actor.onEvent((event) => this.#handleEvent(run, event)),
      initialTimer: setTimeout(() => {
        if (!run.settled) resolveInitial(this.#result(run));
      }, input.observationWindowMs ?? this.#options.observationWindowMs),
      resolveInitial,
      waiters: new Set(),
      finishing: false,
      settled: false,
    };
    this.#active = run;
    this.#emit({ type: 'started', transaction: structuredClone(transaction) });
    void this.#dispatch(run);
    return initialPromise;
  }

  async wait(input: WaitCommandInput): Promise<CommandExecutionResult> {
    const active = this.#active;
    if (active !== undefined && active.transaction.id === input.transactionId) {
      if (active.settled) return this.#result(active);
      return new Promise((resolve) => {
        const waiter = resolve;
        active.waiters.add(waiter);
        if ((input.timeoutMs ?? 30_000) > 0) {
          setTimeout(() => {
            if (!active.waiters.has(waiter)) return;
            active.waiters.delete(waiter);
            resolve(this.#result(active));
          }, input.timeoutMs ?? 30_000);
        }
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
    void this.#actor.interrupt().catch(() => undefined);
    this.#finish(active, { status: 'interrupted', reason: 'interrupt requested' });
    return true;
  }

  dispose(): void {
    if (this.#active !== undefined && !this.#active.settled)
      this.#finish(this.#active, {
        status: 'protocol_error',
        reason: 'executor disposed',
      });
    this.#listeners.clear();
  }

  async #dispatch(run: ActiveRun): Promise<void> {
    try {
      this.#actor.suppressInputEcho(run.dispatch.echoPattern);
      const write = await this.#actor.writeExternal(run.dispatch.payload, run.environmentEpoch);
      if (!write.ok) {
        this.#finish(run, {
          status: 'protocol_error',
          reason: `PTY rejected command write: ${write.error}`,
        });
      }
    } catch (error) {
      this.#finish(run, {
        status: 'protocol_error',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  #handleEvent(run: ActiveRun, event: SessionActorEvent): void {
    if (run.settled) return;
    if (event.type === 'pty_output') {
      run.buffer.append(event.sequence, event.data);
      return;
    }
    if (run.finishing) return;
    if (event.type === 'terminal_output') return;
    if (event.type === 'environment_invalidated') {
      if (run.completionExitCode !== undefined) return;
      this.#finish(run, {
        status: 'protocol_error',
        reason: `current PTY environment invalidated at epoch ${event.capabilityEpoch}`,
      });
      return;
    }
    if (event.type === 'osc_777') {
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
    if (run.completionExitCode !== undefined) {
      this.#finish(run, { status: 'completed', exitCode: run.completionExitCode });
      return;
    }
    this.#finish(run, {
      status: 'shell_lost',
      reason: 'PTY exited before completion frame',
    });
  }

  #finish(
    run: ActiveRun,
    outcome:
      | { status: 'completed'; exitCode: number }
      | { status: 'interrupted' | 'shell_lost' | 'protocol_error'; reason: string },
  ): void {
    if (run.settled || run.finishing) return;
    run.finishing = true;
    const graceMs = outcome.status === 'completed' ? this.#options.completionEchoGraceMs : 0;
    clearTimeout(run.initialTimer);
    clearTimeout(run.completionDrainTimer);
    void this.#actor
      .releaseInputEcho(run.dispatch.echoPattern, { graceMs })
      .then(() => this.#commitFinish(run, outcome))
      .catch((error: unknown) => {
        this.#commitFinish(run, {
          status: 'protocol_error',
          reason: error instanceof Error ? error.message : String(error),
        });
      });
  }

  #commitFinish(
    run: ActiveRun,
    outcome:
      | { status: 'completed'; exitCode: number }
      | { status: 'interrupted' | 'shell_lost' | 'protocol_error'; reason: string },
  ): void {
    if (run.settled) return;
    run.settled = true;
    run.listener();
    const finished: CommandTransaction = {
      ...run.transaction,
      ...outcome,
    };
    run.transaction = finished;
    this.#active = undefined;
    const result = this.#snapshotResult(run, finished);
    this.#history.set(finished.id, result);
    this.#emit({ type: 'finished', transaction: structuredClone(finished) });
    run.resolveInitial(result);
    for (const waiter of run.waiters) {
      run.waiters.delete(waiter);
      waiter(result);
    }
  }

  #result(run: ActiveRun): CommandExecutionResult {
    return this.#snapshotResult(run, run.transaction);
  }

  #snapshotResult(run: ActiveRun, transaction: CommandTransaction): CommandExecutionResult {
    const output = run.buffer.snapshot();
    return {
      transaction: structuredClone(transaction),
      status: transaction.status,
      output,
      cursor: output.cursor,
    };
  }

  #emit(event: CommandExecutorEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
