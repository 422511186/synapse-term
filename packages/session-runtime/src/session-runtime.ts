import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';

import {
  NodePtySpawner,
  SessionManager,
  ShellLocator,
  type SessionActor,
  type SessionActorEvent,
  type PtySpawner,
  type LocalShellDescriptor,
} from '@synapse-term/terminal-service';

export interface SessionSummary {
  id: string;
  title: string;
  terminalType: string;
  pty: 'starting' | 'running' | 'exited' | 'failed' | 'interrupted';
}

export interface SessionEnvironment {
  home: string;
  shells: LocalShellDescriptor[];
}

export interface SessionLaunchInput {
  title: string;
  terminalType: string;
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  columns?: number;
  rows?: number;
}

export interface TerminalOutputEvent {
  sessionId: string;
  sequence: number;
  data: string;
}

export interface AppStatus {
  connected: boolean;
  version: string;
  sessions: number;
}

export interface SessionRuntimeOptions {
  spawner?: PtySpawner;
  home?: string;
  shellLocator?: ShellLocator;
  maxSessions?: number;
  version?: string;
  hideCompletionProbeEcho?: boolean;
}

export interface SessionActorSource {
  get(sessionId: string): SessionActor | undefined;
  titleOf(sessionId: string): string;
  onRemoved(listener: (sessionId: string) => void): () => void;
}

export class SessionRuntime {
  readonly #manager: SessionManager;
  readonly #shellLocator: ShellLocator;
  readonly #home: string;
  readonly #version: string;
  #hideCompletionProbeEcho: boolean;
  readonly #sessionListeners = new Set<(session: SessionSummary) => void>();
  readonly #outputListeners = new Set<(event: TerminalOutputEvent) => void>();

  constructor(options: SessionRuntimeOptions = {}) {
    this.#manager = new SessionManager(
      options.spawner ?? new NodePtySpawner(),
      options.maxSessions === undefined ? {} : { maxSessions: options.maxSessions },
    );
    this.#shellLocator = options.shellLocator ?? new ShellLocator();
    this.#home = options.home ?? homedir();
    this.#version = options.version ?? '0.5.1';
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

  getSessionSource(): SessionActorSource {
    return {
      get: (sessionId) => {
        const actor = this.#manager.get(sessionId);
        return actor?.snapshot.pty === 'running' ? actor : undefined;
      },
      titleOf: (sessionId) => this.#manager.get(sessionId)?.snapshot.title ?? sessionId,
      onRemoved: (listener) =>
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
