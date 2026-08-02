import {
  createSessionState,
  grantAgentLease,
  grantExternalLease,
  invalidateShellCapability,
  markSessionShared,
  releaseExternalLease,
  returnAgentLeaseToUser,
  setSessionExecutionDialect,
  setSessionAttachment,
  takeUserLease,
  transitionSessionPty,
  transitionSessionShell,
  verifyEnvironment,
  type ShellState,
  type SessionState,
  type ExecutionDialect,
  type EnvironmentOperatingSystem,
  type EnvironmentPlatform,
} from '@synapse-term/domain';
import { parseCompletionMarker } from '@synapse-term/domain';

import type { PtyAdapter, PtyDisposable } from '../shell/pty-adapter.js';
import { TerminalModel } from '../model/terminal-model.js';

export interface SessionActorOptions {
  columns?: number;
  rows?: number;
  executionDialect?: ExecutionDialect;
  scrollback?: number;
  terminal?: TerminalModel;
}

export interface AgentWriteInput {
  taskId: string;
  ownerKind?: 'agent' | 'external';
  leaseEpoch: number;
  data: string;
}

export type SessionActorEvent =
  | { type: 'pty_output'; sequence: number; data: string }
  | { type: 'osc_777'; payload: string }
  | { type: 'pty_exit'; exitCode: number; signal?: number | undefined };

export class SessionActor {
  readonly #pty: PtyAdapter;
  readonly #terminal: TerminalModel;
  #state: SessionState;
  #queue: Promise<void> = Promise.resolve();
  #outputSequence = 0;
  #markerCarry = '';
  #osc777Carry = '';
  #disposed = false;
  #ptyExited = false;
  readonly #exitWaiters = new Set<() => void>();
  readonly #eventListeners = new Set<(event: SessionActorEvent) => void>();
  readonly #ptySubscriptions: PtyDisposable[] = [];

  constructor(id: string, pty: PtyAdapter, options: SessionActorOptions = {}) {
    this.#pty = pty;
    this.#terminal =
      options.terminal ??
      new TerminalModel({
        columns: options.columns ?? 80,
        rows: options.rows ?? 24,
        ...(options.scrollback === undefined ? {} : { scrollback: options.scrollback }),
      });
    this.#state = createSessionState(id, options.executionDialect);
    this.#ptySubscriptions.push(
      pty.onData((data) => {
        void this.#enqueue(async () => {
          for (const printableEvent of this.#scanPrintableControls(data)) {
            if (printableEvent.type === 'control') {
              this.#emit({ type: 'osc_777', payload: printableEvent.payload });
              continue;
            }
            for (const event of this.#scanOsc777(printableEvent.data)) {
              if (event.type === 'control') {
                this.#emit({ type: 'osc_777', payload: event.payload });
                continue;
              }
              if (event.data.length === 0) continue;
              await this.#terminal.write(event.data);
              this.#outputSequence += 1;
              this.#emit({
                type: 'pty_output',
                sequence: this.#outputSequence,
                data: event.data,
              });
            }
          }
        });
      }),
      pty.onExit((event) => {
        void this.#enqueue(() => {
          this.#ptyExited = true;
          for (const waiter of this.#exitWaiters) waiter();
          this.#exitWaiters.clear();
          const nextState = event.exitCode === 0 ? 'exited' : 'failed';
          const transition = transitionSessionPty(this.#state, nextState);
          if (transition.ok) this.#state = transition.value;
          this.#emit({ type: 'pty_exit', ...event });
        });
      }),
    );
  }

  get snapshot(): SessionState {
    return structuredClone(this.#state);
  }

  terminalSnapshot(): string {
    return this.#terminal.serialize();
  }

  markPtyRunning(): Promise<void> {
    return this.#enqueue(() => {
      const transition = transitionSessionPty(this.#state, 'running');
      if (!transition.ok) throw new Error(transition.error);
      this.#state = transition.value;
    });
  }

  grantAgentLease(taskId: string, expectedEpoch: number) {
    return this.#enqueue(() => {
      const transition = grantAgentLease(this.#state, taskId, expectedEpoch);
      if (transition.ok) this.#state = transition.value;
      return transition;
    });
  }

  /** 外部调用者 JIT 租约：MCP / ACP 调用按"外部调用者 + Session"持有（ADR-0024） */
  grantExternalLease(callerId: string, expectedEpoch: number) {
    return this.#enqueue(() => {
      const transition = grantExternalLease(this.#state, callerId, expectedEpoch);
      if (transition.ok) this.#state = transition.value;
      return transition;
    });
  }

  releaseExternalLease(callerId: string, expectedEpoch: number) {
    return this.#enqueue(() => {
      const transition = releaseExternalLease(this.#state, callerId, expectedEpoch);
      if (transition.ok) this.#state = transition.value;
      return transition;
    });
  }

  writeAgent(
    input: AgentWriteInput,
  ): Promise<
    | { ok: true }
    | { ok: false; error: 'stale-lease-epoch' | 'lease-not-owned' | 'session-not-running' }
  > {
    return this.#enqueue(() => {
      if (input.leaseEpoch !== this.#state.lease.epoch) {
        return { ok: false as const, error: 'stale-lease-epoch' as const };
      }
      const ownerKind = input.ownerKind ?? 'agent';
      if (ownerKind === 'external') {
        if (
          this.#state.lease.owner.kind !== 'external' ||
          this.#state.lease.owner.callerId !== input.taskId
        ) {
          return { ok: false as const, error: 'lease-not-owned' as const };
        }
      } else if (
        this.#state.lease.owner.kind !== 'agent' ||
        this.#state.lease.owner.taskId !== input.taskId
      ) {
        return { ok: false as const, error: 'lease-not-owned' as const };
      }
      if (this.#state.pty !== 'running') {
        return { ok: false as const, error: 'session-not-running' as const };
      }

      this.#pty.write(input.data);
      return { ok: true as const };
    });
  }

  transitionShell(nextState: ShellState): Promise<void> {
    return this.#enqueue(() => {
      const transition = transitionSessionShell(this.#state, nextState);
      if (!transition.ok) throw new Error(transition.error);
      this.#state = transition.value;
    });
  }

  setExecutionDialect(executionDialect: ExecutionDialect): Promise<void> {
    return this.#enqueue(() => {
      this.#state = setSessionExecutionDialect(this.#state, executionDialect);
    });
  }

  /** 用户显式复制 sessionId 后标记为外部可寻址（Shared Session，ADR-0022） */
  markShared(): Promise<void> {
    return this.#enqueue(() => {
      this.#state = markSessionShared(this.#state, new Date().toISOString());
    });
  }

  verifyCurrentEnvironment(
    dialect: ExecutionDialect,
    platform: EnvironmentPlatform,
    operatingSystem?: EnvironmentOperatingSystem,
  ): Promise<void> {
    return this.#enqueue(() => {
      this.#state = {
        ...this.#state,
        environment: verifyEnvironment(
          this.#state.environment,
          dialect,
          platform,
          () => new Date().toISOString(),
          operatingSystem,
        ),
      };
    });
  }

  writeUser(data: string): Promise<{ ok: true } | { ok: false; error: 'session-not-running' }> {
    return this.#enqueue(() => {
      if (this.#state.pty !== 'running') {
        return { ok: false as const, error: 'session-not-running' as const };
      }
      this.#state = invalidateShellCapability(takeUserLease(this.#state));
      this.#pty.write(data);
      return { ok: true as const };
    });
  }

  takeoverUser(): Promise<void> {
    return this.#enqueue(() => {
      this.#state = invalidateShellCapability(takeUserLease(this.#state));
    });
  }

  returnAgentLeaseToUser(taskId: string, expectedEpoch: number) {
    return this.#enqueue(() => {
      const transition = returnAgentLeaseToUser(this.#state, taskId, expectedEpoch);
      if (transition.ok) this.#state = transition.value;
      return transition;
    });
  }

  interrupt(): Promise<void> {
    return this.#enqueue(() => {
      if (this.#state.pty !== 'running') return;
      this.#pty.interrupt();
    });
  }

  resize(columns: number, rows: number): Promise<void> {
    if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) {
      return Promise.reject(new RangeError('terminal dimensions must be positive integers'));
    }
    return this.#enqueue(() => {
      if (this.#state.pty !== 'running') return;
      this.#pty.resize(columns, rows);
      this.#terminal.resize(columns, rows);
    });
  }

  attachUi(): Promise<void> {
    return this.#enqueue(() => {
      this.#state = setSessionAttachment(this.#state, 'attached');
    });
  }

  detachUi(): Promise<void> {
    return this.#enqueue(() => {
      this.#state = setSessionAttachment(this.#state, 'detached');
    });
  }

  markInterrupted(): Promise<void> {
    return this.#enqueue(() => {
      const transition = transitionSessionPty(this.#state, 'interrupted');
      if (!transition.ok) throw new Error(transition.error);
      this.#state = transition.value;
    });
  }

  terminate(): Promise<void> {
    return this.#enqueue(() => {
      this.#pty.terminate();
    });
  }

  waitForExit(timeoutMs = 1_000): Promise<void> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      return Promise.reject(new RangeError('exit timeout must be non-negative'));
    }
    if (this.#ptyExited || this.#state.pty === 'exited' || this.#state.pty === 'failed') {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.#exitWaiters.delete(finish);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      this.#exitWaiters.add(finish);
    });
  }

  onEvent(listener: (event: SessionActorEvent) => void): PtyDisposable {
    this.#eventListeners.add(listener);
    return { dispose: () => this.#eventListeners.delete(listener) };
  }

  idle(): Promise<void> {
    return this.#queue;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const subscription of this.#ptySubscriptions) subscription.dispose();
    this.#ptySubscriptions.length = 0;
    this.#eventListeners.clear();
    for (const waiter of this.#exitWaiters) waiter();
    this.#exitWaiters.clear();
    this.#markerCarry = '';
    this.#osc777Carry = '';
    this.#terminal.dispose();
  }

  #scanOsc777(
    data: string,
  ): Array<{ type: 'output'; data: string } | { type: 'control'; payload: string }> {
    const prefix = '\u001b]777;';
    const input = this.#osc777Carry + data;
    this.#osc777Carry = '';
    const events: Array<{ type: 'output'; data: string } | { type: 'control'; payload: string }> =
      [];
    let index = 0;
    while (index < input.length) {
      const start = input.indexOf(prefix, index);
      if (start < 0) {
        const suffixStart = possiblePrefixStart(input, prefix, index);
        if (suffixStart > index) {
          events.push({ type: 'output', data: input.slice(index, suffixStart) });
        }
        if (suffixStart < input.length) this.#osc777Carry = input.slice(suffixStart);
        break;
      }
      if (start > index) events.push({ type: 'output', data: input.slice(index, start) });
      const end = input.indexOf('\u0007', start + prefix.length);
      if (end < 0) {
        this.#osc777Carry = input.slice(start);
        break;
      }
      events.push({ type: 'control', payload: input.slice(start + prefix.length, end) });
      index = end + 1;
    }
    return events;
  }

  #scanPrintableControls(
    data: string,
  ): Array<{ type: 'output'; data: string } | { type: 'control'; payload: string }> {
    const startMarker = '__TA_START__';
    const completionPrefix = '__TA_DONE_';
    const input = this.#markerCarry + data;
    this.#markerCarry = '';
    const events: Array<{ type: 'output'; data: string } | { type: 'control'; payload: string }> =
      [];
    let index = 0;
    while (index < input.length) {
      const startMarkerIndex = input.indexOf(startMarker, index);
      const completionIndex = input.indexOf(completionPrefix, index);
      const start = firstIndex(startMarkerIndex, completionIndex);
      if (start < 0) {
        const suffixStart = Math.min(
          possiblePrefixStart(input, startMarker, index),
          possiblePrefixStart(input, completionPrefix, index),
        );
        if (suffixStart > index) {
          events.push({ type: 'output', data: input.slice(index, suffixStart) });
        }
        if (suffixStart < input.length) this.#markerCarry = input.slice(suffixStart);
        break;
      }
      if (start > index) events.push({ type: 'output', data: input.slice(index, start) });
      if (start === startMarkerIndex) {
        events.push({ type: 'control', payload: 'TA_START' });
        index = start + startMarker.length;
        continue;
      }
      const end = input.indexOf('__', start + completionPrefix.length);
      if (end < 0) {
        this.#markerCarry = input.slice(start);
        break;
      }
      const marker = input.slice(start, end + 2);
      const frame = parseCompletionMarker(marker);
      if (frame === null) events.push({ type: 'output', data: marker });
      else events.push({ type: 'control', payload: `TA;${frame.nonce};${frame.exitCode}` });
      index = end + 2;
    }
    return events;
  }

  #emit(event: SessionActorEvent): void {
    for (const listener of this.#eventListeners) listener(event);
  }

  #enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function possiblePrefixStart(value: string, prefix: string, from: number): number {
  const end = value.length;
  for (let length = Math.min(prefix.length - 1, end - from); length > 0; length -= 1) {
    const start = end - length;
    if (start < from) continue;
    if (value.slice(start) === prefix.slice(0, length)) return start;
  }
  return end;
}

function firstIndex(left: number, right: number): number {
  if (left < 0) return right;
  if (right < 0) return left;
  return Math.min(left, right);
}
