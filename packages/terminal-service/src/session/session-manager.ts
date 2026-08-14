import type { TerminalBackend } from '@synapse-term/domain';

import type { PtySpawnOptions, PtySpawner } from '../shell/pty-adapter.js';
import { SessionActor, type SessionActorEvent } from './session-actor.js';

export interface SessionCreateRequest {
  id: string;
  title: string;
  terminalType: string;
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
    this.#terminationWaitMs = options.terminationWaitMs ?? 1_000;
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

    const backend: TerminalBackend = this.#spawner.spawn(config.launch);
    const actor = new SessionActor(config.id, backend, {
      title: config.title,
      terminalType: config.terminalType,
      columns: config.launch.columns,
      rows: config.launch.rows,
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
      eventSubscription?.();
      backend.terminate();
      actor.dispose();
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
