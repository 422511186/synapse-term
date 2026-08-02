import { SessionActor, type SessionActorEvent } from './session-actor.js';
import type { PtySpawnOptions, PtySpawner } from '../shell/pty-adapter.js';
import type { ExecutionDialect } from '@synapse-term/domain';

export interface SessionCreateRequest {
  id: string;
  executionDialect?: ExecutionDialect;
  launch: PtySpawnOptions;
  onEvent?(actor: SessionActor, event: SessionActorEvent): void;
}

export interface SessionManagerOptions {
  maxSessions?: number;
  terminationWaitMs?: number;
}

export class SessionResourceError extends Error {
  readonly code: 'session_limit_reached' | 'session_exists';

  constructor(code: 'session_limit_reached' | 'session_exists', message: string) {
    super(message);
    this.name = 'SessionResourceError';
    this.code = code;
  }
}

export class SessionManager {
  readonly #spawner: PtySpawner;
  readonly #maxSessions: number;
  readonly #terminationWaitMs: number;
  readonly #sessions = new Map<string, SessionActor>();

  constructor(spawner: PtySpawner, options: SessionManagerOptions = {}) {
    this.#spawner = spawner;
    this.#maxSessions = options.maxSessions ?? 20;
    this.#terminationWaitMs = options.terminationWaitMs ?? 250;
    if (!Number.isInteger(this.#maxSessions) || this.#maxSessions < 1) {
      throw new RangeError('maxSessions must be a positive integer');
    }
    if (!Number.isFinite(this.#terminationWaitMs) || this.#terminationWaitMs < 0) {
      throw new RangeError('terminationWaitMs must be non-negative');
    }
  }

  get activeCount(): number {
    return this.#sessions.size;
  }

  async create(config: SessionCreateRequest): Promise<SessionActor> {
    if (this.#sessions.size >= this.#maxSessions) {
      throw new SessionResourceError('session_limit_reached', 'active Session limit reached');
    }
    if (this.#sessions.has(config.id)) {
      throw new SessionResourceError('session_exists', `Session ${config.id} already exists`);
    }

    const pty = this.#spawner.spawn(config.launch);
    const actor = new SessionActor(config.id, pty, {
      columns: config.launch.columns,
      rows: config.launch.rows,
      ...(config.executionDialect === undefined
        ? {}
        : { executionDialect: config.executionDialect }),
    });
    const subscription = actor.onEvent((event) => {
      if (event.type === 'pty_exit' && this.#sessions.get(config.id) === actor) {
        this.#sessions.delete(config.id);
        queueMicrotask(() => {
          subscription?.dispose();
          actor.dispose();
        });
      }
    });
    const eventSubscription =
      config.onEvent === undefined
        ? undefined
        : actor.onEvent((event) => config.onEvent?.(actor, event));
    try {
      await actor.markPtyRunning();
      this.#sessions.set(config.id, actor);
      return actor;
    } catch (error) {
      eventSubscription?.dispose();
      subscription.dispose();
      pty.terminate();
      throw error;
    }
  }

  get(id: string): SessionActor | undefined {
    return this.#sessions.get(id);
  }

  list(): SessionActor[] {
    return [...this.#sessions.values()];
  }

  async close(id: string): Promise<boolean> {
    const actor = this.#sessions.get(id);
    if (actor === undefined) return false;
    await actor.terminate();
    await actor.waitForExit(this.#terminationWaitMs);
    this.#sessions.delete(id);
    actor.dispose();
    return true;
  }
}
