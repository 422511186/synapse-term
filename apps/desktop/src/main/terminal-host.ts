import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';

import {
  NodePtySpawner,
  SessionManager,
  ShellLocator,
  type SessionActor,
  type SessionActorEvent,
  type PtySpawner,
} from '@synapse-term/terminal-service';

import type {
  AppStatus,
  SessionEnvironment,
  SessionLaunchInput,
  SessionSummary,
  TerminalOutputEvent,
} from '../shared/contracts.js';

export interface TerminalHostOptions {
  spawner?: PtySpawner;
  home?: string;
  shellLocator?: ShellLocator;
  maxSessions?: number;
  version?: string;
  hideCompletionProbeEcho?: boolean;
}

export class TerminalHost {
  readonly #manager: SessionManager;
  readonly #shellLocator: ShellLocator;
  readonly #home: string;
  readonly #version: string;
  #hideCompletionProbeEcho: boolean;
  readonly #sessionListeners = new Set<(session: SessionSummary) => void>();
  readonly #outputListeners = new Set<(event: TerminalOutputEvent) => void>();

  constructor(options: TerminalHostOptions = {}) {
    this.#manager = new SessionManager(
      options.spawner ?? new NodePtySpawner(),
      options.maxSessions === undefined ? {} : { maxSessions: options.maxSessions },
    );
    this.#shellLocator = options.shellLocator ?? new ShellLocator();
    this.#home = options.home ?? homedir();
    this.#version = options.version ?? '0.5.0';
    this.#hideCompletionProbeEcho = options.hideCompletionProbeEcho ?? true;
  }

  listSessions(): SessionSummary[] {
    return this.#manager.list().map(toSummary);
  }

  environment(): SessionEnvironment {
    return { home: this.#home, shells: this.#shellLocator.list() };
  }

  async createSession(input: SessionLaunchInput): Promise<SessionSummary> {
    const id = randomUUID();
    const env = {
      ...process.env,
      ...input.env,
      TERM: input.env.TERM ?? process.env.TERM ?? 'xterm-256color',
    };
    const actor = await this.#manager.create({
      id,
      title: input.title,
      terminalType: input.terminalType,
      hideCompletionProbeEcho: this.#hideCompletionProbeEcho,
      launch: {
        executable: input.executable,
        args: input.args,
        cwd: input.cwd.trim().length > 0 ? input.cwd : this.#home,
        env,
        columns: input.columns ?? 80,
        rows: input.rows ?? 24,
      },
      onEvent: (actor, event) => this.#handleActorEvent(actor, event),
    });
    const summary = toSummary(actor);
    this.#emitSessionChanged(summary);
    return summary;
  }

  async renameSession(sessionId: string, alias: string): Promise<SessionSummary> {
    const actor = this.#requireSession(sessionId);
    await actor.rename(alias);
    const summary = toSummary(actor);
    this.#emitSessionChanged(summary);
    return summary;
  }

  async closeSession(sessionId: string): Promise<boolean> {
    return this.#manager.close(sessionId);
  }

  async write(sessionId: string, data: string): Promise<void> {
    const actor = this.#requireSession(sessionId);
    const result = await actor.writeUser(data);
    if (!result.ok) throw new Error('Session is not running');
  }

  async setProbeEchoVisibility(hide: boolean): Promise<void> {
    this.#hideCompletionProbeEcho = hide;
    await Promise.all(this.#manager.list().map((actor) => actor.setProbeEchoVisibility(hide)));
  }

  async resize(sessionId: string, columns: number, rows: number): Promise<void> {
    const actor = this.#requireSession(sessionId);
    await actor.resize(columns, rows);
  }

  status(): AppStatus {
    return {
      connected: true,
      version: this.#version,
      sessions: this.#manager.activeCount,
    };
  }

  onSessionChanged(listener: (session: SessionSummary) => void): () => void {
    this.#sessionListeners.add(listener);
    return () => this.#sessionListeners.delete(listener);
  }

  getMcpSessionSource(): {
    get(sessionId: string): SessionActor | undefined;
    titleOf(sessionId: string): string;
    notifyRemoved(listener: (sessionId: string) => void): () => void;
  } {
    return {
      get: (sessionId) => {
        const actor = this.#manager.get(sessionId);
        return actor?.snapshot.pty === 'running' ? actor : undefined;
      },
      titleOf: (sessionId) => this.#manager.get(sessionId)?.snapshot.title ?? sessionId,
      notifyRemoved: (listener) =>
        this.onSessionChanged((session) => {
          if (session.pty !== 'running') listener(session.id);
        }),
    };
  }

  onTerminalOutput(listener: (event: TerminalOutputEvent) => void): () => void {
    this.#outputListeners.add(listener);
    return () => this.#outputListeners.delete(listener);
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.#manager.list().map((actor) => this.#manager.close(actor.snapshot.id)));
  }

  async handle(channel: string, args: readonly unknown[]): Promise<unknown> {
    switch (channel) {
      case 'sessions:list':
        return this.listSessions();
      case 'sessions:environment':
        return this.environment();
      case 'sessions:create':
        return this.createSession(parseLaunchInput(args[0]));
      case 'sessions:rename':
        return this.renameSession(idArg(args[0]), boundedString(args[1], 128, 'alias'));
      case 'sessions:close':
        return this.closeSession(idArg(args[0]));
      case 'terminal:write':
        return this.write(idArg(args[0]), boundedString(args[1], 1_000_000, 'data'));
      case 'terminal:resize':
        return this.resize(idArg(args[0]), dimensionArg(args[1]), dimensionArg(args[2]));
      case 'app:status':
        return this.status();
      default:
        throw new Error(`Renderer channel is not available: ${channel}`);
    }
  }

  #requireSession(sessionId: string): SessionActor {
    const actor = this.#manager.get(sessionId);
    if (actor === undefined) throw new Error('Session not found');
    return actor;
  }

  #handleActorEvent(actor: SessionActor, event: SessionActorEvent): void {
    if (event.type === 'terminal_output') {
      for (const listener of this.#outputListeners) {
        listener({ sessionId: actor.snapshot.id, sequence: event.sequence, data: event.data });
      }
      return;
    }
    if (event.type === 'pty_exit') {
      this.#emitSessionChanged(toSummary(actor));
    }
  }

  #emitSessionChanged(session: SessionSummary): void {
    for (const listener of this.#sessionListeners) listener(session);
  }
}

function toSummary(actor: SessionActor): SessionSummary {
  const state = actor.snapshot;
  return {
    id: state.id,
    title: state.title,
    terminalType: state.terminalType,
    pty: state.pty,
  };
}

function parseLaunchInput(value: unknown): SessionLaunchInput {
  if (typeof value !== 'object' || value === null) throw new TypeError('expected launch input');
  const input = value as Record<string, unknown>;
  return {
    title: boundedString(input.title, 128, 'title'),
    terminalType: boundedString(input.terminalType, 128, 'terminalType'),
    executable: boundedString(input.executable, 4_096, 'executable'),
    args: stringArrayArg(input.args),
    cwd: boundedString(input.cwd, 4_096, 'cwd'),
    env: recordArg(input.env),
    ...(input.columns === undefined ? {} : { columns: dimensionArg(input.columns) }),
    ...(input.rows === undefined ? {} : { rows: dimensionArg(input.rows) }),
  };
}

function idArg(value: unknown): string {
  return boundedString(value, 256, 'sessionId');
}

function boundedString(value: unknown, maxLength: number, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function numberArg(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('expected a number argument');
  }
  return value;
}

function stringArrayArg(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 256 ||
    value.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 1_024)
  ) {
    throw new TypeError('expected a string array argument');
  }
  return [...value] as string[];
}

function recordArg(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === 'string' && entry[0].length > 0 && entry[0].length <= 256,
  );
  if (entries.length > 64 || entries.some(([, entryValue]) => entryValue.length > 4_096)) {
    throw new TypeError('environment is invalid');
  }
  return Object.fromEntries(entries);
}

function dimensionArg(value: unknown): number {
  const parsed = numberArg(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000) {
    throw new RangeError('terminal dimension must be between 1 and 1000');
  }
  return parsed;
}
