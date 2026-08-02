import type { Socket } from 'node:net';

import { getCoreDataPaths } from './core-paths.js';
import { NamedPipeServer } from './named-pipe.js';
import { FileStartupLock } from './startup-lock.js';

export interface CorePipeServer {
  listen(pipeName: string, handler?: (socket: Socket) => void): Promise<void>;
  close(): Promise<void>;
}

export interface CoreLifecycleOptions {
  appId: string;
  username: string;
  dataDirectory: string;
  instanceId: string;
  pipeServer?: CorePipeServer;
  lock?: FileStartupLock;
  terminateSessions?: () => Promise<void>;
  idleExitDelayMs?: number;
  timer?: CoreTimer;
  handleConnection?: (socket: Socket) => void;
}

export interface CoreTimer {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(id: unknown): void;
}

export type CoreLifecycleState = 'stopped' | 'starting' | 'running' | 'closing' | 'closed';

export class CoreLifecycle {
  readonly #paths: ReturnType<typeof getCoreDataPaths>;
  readonly #pipeServer: CorePipeServer;
  readonly #lock: FileStartupLock;
  readonly #terminateSessions: () => Promise<void>;
  #state: CoreLifecycleState = 'stopped';
  #sessions = 0;
  #agentTasks = 0;
  #clientConnections = 0;
  readonly #idleExitDelayMs: number | undefined;
  readonly #timer: CoreTimer;
  readonly #handleConnection: (socket: Socket) => void;
  #idleTimer: unknown;
  #closePromise: Promise<void> | undefined;
  readonly #closedPromise: Promise<void>;
  #resolveClosed!: () => void;
  #closedSignalled = false;

  constructor(options: CoreLifecycleOptions) {
    this.#closedPromise = new Promise<void>((resolve) => {
      this.#resolveClosed = resolve;
    });
    this.#paths = getCoreDataPaths(options.dataDirectory, options.appId, options.username);
    this.#pipeServer = options.pipeServer ?? new NamedPipeServer();
    this.#lock =
      options.lock ??
      new FileStartupLock(this.#paths.lockPath, {
        pid: process.pid,
        instanceId: options.instanceId,
        startedAt: new Date().toISOString(),
      });
    this.#terminateSessions = options.terminateSessions ?? (async () => undefined);
    this.#idleExitDelayMs = options.idleExitDelayMs;
    this.#timer = options.timer ?? {
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    };
    this.#handleConnection = options.handleConnection ?? ((socket) => socket.destroy());
    if (
      this.#idleExitDelayMs !== undefined &&
      (!Number.isFinite(this.#idleExitDelayMs) || this.#idleExitDelayMs < 0)
    ) {
      throw new RangeError('idleExitDelayMs must be non-negative');
    }
  }

  get state(): CoreLifecycleState {
    return this.#state;
  }

  get activity(): { sessions: number; agentTasks: number } {
    return { sessions: this.#sessions, agentTasks: this.#agentTasks };
  }

  setActivity(activity: { sessions: number; agentTasks: number }): void {
    if (
      !Number.isInteger(activity.sessions) ||
      activity.sessions < 0 ||
      !Number.isInteger(activity.agentTasks) ||
      activity.agentTasks < 0
    ) {
      throw new RangeError('Core activity counts must be non-negative integers');
    }
    this.#sessions = activity.sessions;
    this.#agentTasks = activity.agentTasks;
    this.#refreshIdleExit();
  }

  setClientConnections(connections: number): void {
    if (!Number.isInteger(connections) || connections < 0) {
      throw new RangeError('Core client connection count must be a non-negative integer');
    }
    this.#clientConnections = connections;
    this.#refreshIdleExit();
  }

  async start(): Promise<{ ok: true; state: 'running'; pipeName: string }> {
    if (this.#state === 'running') {
      return { ok: true, state: 'running', pipeName: this.#paths.pipeName };
    }
    if (this.#state !== 'stopped') {
      throw new Error(`Core cannot start from ${this.#state}`);
    }

    this.#state = 'starting';
    try {
      await this.#lock.acquire();
      await this.#pipeServer.listen(this.#paths.pipeName, this.#handleConnection);
      this.#state = 'running';
      if (this.#isIdle() && this.#idleExitDelayMs !== undefined) {
        this.#scheduleIdleExit();
      }
      return { ok: true, state: 'running', pipeName: this.#paths.pipeName };
    } catch (error) {
      await this.#lock.release().catch(() => undefined);
      this.#state = 'stopped';
      throw error;
    }
  }

  async requestShutdown(
    mode: 'keep_background' | 'terminate_all',
  ): Promise<
    | { ok: true; action: 'kept_background'; state: 'running' }
    | { ok: true; action: 'terminated'; state: 'closed' }
  > {
    if (mode === 'keep_background') {
      if (this.#state !== 'running') throw new Error(`Core is ${this.#state}`);
      return { ok: true, action: 'kept_background', state: 'running' };
    }

    if (this.#state !== 'running') throw new Error(`Core is ${this.#state}`);
    let terminationError: unknown;
    try {
      await this.#terminateSessions();
    } catch (error) {
      terminationError = error;
    } finally {
      await this.close();
    }
    if (terminationError !== undefined) throw terminationError;
    return { ok: true, action: 'terminated', state: 'closed' };
  }

  async close(): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise;
    const operation = this.#performClose();
    const wrapped = operation.finally(() => {
      if (this.#closePromise === wrapped) this.#closePromise = undefined;
    });
    this.#closePromise = wrapped;
    return wrapped;
  }

  async waitForClose(): Promise<void> {
    await this.#closedPromise;
  }

  async #performClose(): Promise<void> {
    this.#cancelIdleExit();
    if (this.#state === 'closed' || this.#state === 'stopped') {
      this.#state = 'closed';
      await this.#lock.release();
      this.#signalClosed();
      return;
    }

    this.#state = 'closing';
    try {
      await this.#pipeServer.close();
    } finally {
      await this.#lock.release();
      this.#state = 'closed';
      this.#signalClosed();
    }
  }

  #scheduleIdleExit(): void {
    if (this.#idleTimer !== undefined || this.#idleExitDelayMs === undefined) return;
    this.#idleTimer = this.#timer.setTimeout(() => {
      this.#idleTimer = undefined;
      if (this.#isIdle() && this.#state === 'running') {
        void this.close();
      }
    }, this.#idleExitDelayMs);
  }

  #refreshIdleExit(): void {
    if (!this.#isIdle()) {
      this.#cancelIdleExit();
      return;
    }
    if (this.#state === 'running' && this.#idleExitDelayMs !== undefined) {
      this.#scheduleIdleExit();
    }
  }

  #isIdle(): boolean {
    return this.#sessions === 0 && this.#agentTasks === 0 && this.#clientConnections === 0;
  }

  #cancelIdleExit(): void {
    if (this.#idleTimer === undefined) return;
    this.#timer.clearTimeout(this.#idleTimer);
    this.#idleTimer = undefined;
  }

  #signalClosed(): void {
    if (this.#closedSignalled) return;
    this.#closedSignalled = true;
    this.#resolveClosed();
  }
}
