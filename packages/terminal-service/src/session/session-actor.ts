import {
  createSessionState,
  resizeSession,
  transitionSessionPty,
  type SessionState,
  type TerminalBackend,
  type TerminalExitEvent,
  type TerminalSubscription,
} from '@synapse-term/domain';

import { splitTerminalOutput, TERMINAL_OUTPUT_FRAME_BYTES } from './output-frame.js';

export interface SessionActorOptions {
  title: string;
  terminalType: string;
  columns?: number;
  rows?: number;
}

export type SessionActorEvent =
  | { type: 'pty_output'; sequence: number; data: string }
  | { type: 'pty_exit'; exitCode: number; signal?: number | undefined };

export class SessionActor {
  readonly #backend: TerminalBackend;
  #state: SessionState;
  #outputSequence = 0;
  #escapeCarry = '';
  #queue: Promise<void> = Promise.resolve();
  #disposed = false;
  #ptyExited = false;
  readonly #exitWaiters = new Set<() => void>();
  readonly #eventListeners = new Set<(event: SessionActorEvent) => void>();
  readonly #subscriptions: TerminalSubscription[] = [];

  constructor(id: string, backend: TerminalBackend, options: SessionActorOptions) {
    this.#backend = backend;
    this.#state = createSessionState({
      id,
      title: options.title,
      terminalType: options.terminalType,
      ...(options.columns === undefined ? {} : { columns: options.columns }),
      ...(options.rows === undefined ? {} : { rows: options.rows }),
    });
    this.#subscriptions.push(
      backend.onData((data) => {
        void this.#enqueue(() => {
          if (this.#disposed) return;
          const { chunks, carry } = splitTerminalOutput(
            data,
            TERMINAL_OUTPUT_FRAME_BYTES,
            this.#escapeCarry,
          );
          this.#escapeCarry = carry;
          for (const chunk of chunks) {
            this.#outputSequence += 1;
            this.#emit({ type: 'pty_output', sequence: this.#outputSequence, data: chunk });
          }
        });
      }),
      backend.onExit((event: TerminalExitEvent) => {
        void this.#enqueue(() => {
          this.#ptyExited = true;
          for (const waiter of this.#exitWaiters) waiter();
          this.#exitWaiters.clear();
          const next = event.exitCode === 0 ? 'exited' : 'failed';
          const transition = transitionSessionPty(this.#state, next);
          if (transition.ok) this.#state = transition.value;
          this.#emit({ type: 'pty_exit', ...event });
        });
      }),
    );
  }

  get snapshot(): SessionState {
    return structuredClone(this.#state);
  }

  onEvent(listener: (event: SessionActorEvent) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  markPtyRunning(): Promise<void> {
    return this.#enqueue(() => {
      const transition = transitionSessionPty(this.#state, 'running');
      if (!transition.ok) throw new Error(transition.error);
      this.#state = transition.value;
    });
  }

  rename(title: string): Promise<void> {
    return this.#enqueue(() => {
      this.#state = { ...this.#state, title: title.trim() };
    });
  }

  writeUser(data: string): Promise<{ ok: true } | { ok: false; error: 'session-not-running' }> {
    return this.#enqueue(() => {
      if (this.#state.pty !== 'running') {
        return { ok: false as const, error: 'session-not-running' as const };
      }
      this.#backend.write(data);
      return { ok: true as const };
    });
  }

  resize(columns: number, rows: number): Promise<void> {
    return this.#enqueue(() => {
      this.#state = resizeSession(this.#state, columns, rows);
      if (this.#state.pty === 'running') this.#backend.resize(columns, rows);
    });
  }

  terminate(): Promise<void> {
    return this.#enqueue(() => {
      this.#backend.terminate();
    });
  }

  waitForExit(timeoutMs: number): Promise<void> {
    if (this.#ptyExited) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#exitWaiters.delete(waiter);
        resolve();
      }, timeoutMs);
      const waiter = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.#exitWaiters.add(waiter);
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const subscription of this.#subscriptions) subscription.dispose();
    this.#eventListeners.clear();
    this.#exitWaiters.clear();
  }

  #emit(event: SessionActorEvent): void {
    for (const listener of this.#eventListeners) listener(event);
  }

  #enqueue<T>(task: () => T): Promise<T> {
    const next = this.#queue.then(task, task);
    this.#queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
