/**
 * Session / Terminal 请求处理
 *
 * 负责 session.* 与 terminal.* 用例：会话生命周期、终端写入/缩放/回放、
 * 会话元数据与事件推送。依赖注入自 CoreRequestRouter，不持有其他域 handler。
 */
import { randomUUID } from 'node:crypto';

import { isSessionShared, type SessionState } from '@synapse-term/domain';
import type { AuditRecordInput, CoreRepositories } from '@synapse-term/infrastructure';
import type {
  CoreServiceEvent,
  SessionLaunch,
  SessionLaunchMetadata,
  SessionSummary,
  TerminalReplay,
} from '@synapse-term/protocol';
import type {
  OutputJournal,
  SessionActor,
  SessionActorEvent,
  SessionManager,
} from '@synapse-term/terminal-service';

import { routerError } from '../contracts.js';
import type { AuditQueryLike, TerminalOutputNotification } from '../contracts.js';

export interface SessionRequestHandlerOptions {
  sessions: SessionManager;
  journal: OutputJournal;
  repositories: CoreRepositories;
  emitTerminalOutput(event: TerminalOutputNotification): void;
  emitEvent?: ((event: CoreServiceEvent) => void) | undefined;
  onActivityChange?: ((activity: { sessions: number; agentTasks: number }) => void) | undefined;
  audit?: AuditQueryLike | undefined;
}

export class SessionRequestHandler {
  readonly #sessions: SessionManager;
  readonly #journal: OutputJournal;
  readonly #repositories: CoreRepositories;
  readonly #emitTerminalOutput: (event: TerminalOutputNotification) => void;
  readonly #emitEvent: (event: CoreServiceEvent) => void;
  readonly #onActivityChange: (activity: { sessions: number; agentTasks: number }) => void;
  readonly #audit: AuditQueryLike | undefined;
  readonly #titles = new Map<string, string>();
  readonly #terminalTypes = new Map<string, string>();

  constructor(options: SessionRequestHandlerOptions) {
    this.#sessions = options.sessions;
    this.#journal = options.journal;
    this.#repositories = options.repositories;
    this.#emitTerminalOutput = options.emitTerminalOutput;
    this.#emitEvent = options.emitEvent ?? (() => undefined);
    this.#onActivityChange = options.onActivityChange ?? (() => undefined);
    this.#audit = options.audit;
    for (const record of this.#repositories.listSessionMetadata()) {
      this.#titles.set(record.id, record.metadata.title);
      this.#terminalTypes.set(record.id, record.metadata.launch.terminalType);
    }
  }

  listSessions(): SessionSummary[] {
    const active = new Map(this.#sessions.list().map((actor) => [actor.snapshot.id, actor]));
    const summaries = new Map<string, SessionSummary>();
    for (const state of this.#repositories.listSessions()) {
      summaries.set(
        state.id,
        this.#summary(state.id, this.#titles.get(state.id) ?? state.id, state),
      );
    }
    for (const actor of active.values()) {
      const state = actor.snapshot;
      summaries.set(
        state.id,
        this.#summary(state.id, this.#titles.get(state.id) ?? state.id, state),
      );
    }
    return [...summaries.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  async createSession(input: SessionLaunch): Promise<SessionSummary> {
    const id = randomUUID();
    this.#titles.set(id, input.title);
    this.#terminalTypes.set(id, input.terminalType);
    let actor: SessionActor;
    try {
      actor = await this.#sessions.create({
        id,
        executionDialect: input.executionDialect,
        launch: {
          executable: input.executable,
          args: input.args,
          cwd: input.cwd,
          env: input.env,
          columns: input.columns,
          rows: input.rows,
        },
        onEvent: (session, event) => this.#handleSessionEvent(id, session, event),
      });
    } catch (error) {
      this.#titles.delete(id);
      this.#terminalTypes.delete(id);
      throw error;
    }
    this.#save(actor, {
      title: input.title,
      launch: {
        executable: input.executable,
        terminalType: input.terminalType,
        args: input.args,
        cwd: input.cwd,
        columns: input.columns,
        rows: input.rows,
        executionDialect: input.executionDialect,
        envKeys: Object.keys(input.env).sort(),
      },
    });
    this.#recordAudit({
      actor: { kind: 'user' },
      sessionId: id,
      type: 'session.created',
      payload: { title: input.title, executable: input.executable },
    });
    this.#onActivityChange({ sessions: this.#sessions.activeCount, agentTasks: 0 });
    const summary = this.#summary(id, input.title, actor.snapshot);
    this.#emitChanged(summary);
    return summary;
  }

  async closeSession(sessionId: string): Promise<boolean> {
    const persisted = this.#repositories.getSession(sessionId);
    const closed = await this.#sessions.close(sessionId);
    if (!closed && persisted === undefined) return false;
    this.#titles.delete(sessionId);
    this.#terminalTypes.delete(sessionId);
    this.#repositories.deleteSession(sessionId);
    this.#recordAudit({
      actor: { kind: 'user' },
      sessionId,
      type: 'session.closed',
      payload: { pty: persisted?.pty ?? 'running' },
    });
    this.#onActivityChange({ sessions: this.#sessions.activeCount, agentTasks: 0 });
    return true;
  }

  async setSessionDialect(
    sessionId: string,
    executionDialect: SessionLaunch['executionDialect'],
  ): Promise<SessionSummary> {
    const actor = this.#sessions.get(sessionId);
    if (actor === undefined) throw routerError('session_not_found', 'Session not found');
    await actor.setExecutionDialect(executionDialect);
    this.#save(actor);
    this.#recordAudit({
      actor: { kind: 'user' },
      sessionId,
      type: 'session.dialect_changed',
      payload: { executionDialect },
    });
    const summary = this.#summary(
      sessionId,
      this.#titles.get(sessionId) ?? sessionId,
      actor.snapshot,
    );
    this.#emitChanged(summary);
    return summary;
  }

  /** 用户复制 sessionId：标记 Shared Session（ADR-0022），不改变 Lease 与安全边界 */
  async markSessionShared(sessionId: string): Promise<SessionSummary> {
    const actor = this.#requireSession(sessionId);
    await actor.markShared();
    this.#save(actor);
    this.#recordAudit({
      actor: { kind: 'user' },
      sessionId,
      type: 'session.shared',
      payload: { sharedAt: actor.snapshot.sharedAt },
    });
    const summary = this.#summary(
      sessionId,
      this.#titles.get(sessionId) ?? sessionId,
      actor.snapshot,
    );
    this.#emitChanged(summary);
    return summary;
  }

  async writeTerminal(sessionId: string, data: string): Promise<null> {
    const actor = this.#requireSession(sessionId);
    const result = await actor.writeUser(data);
    if (!result.ok) throw routerError('session_not_ready', result.error);
    this.#recordAudit({
      actor: { kind: 'user' },
      sessionId,
      type: 'session.input',
      payload: { bytes: Buffer.byteLength(data, 'utf8') },
    });
    this.#save(actor);
    this.#emitChanged(
      this.#summary(sessionId, this.#titles.get(sessionId) ?? sessionId, actor.snapshot),
    );
    return null;
  }

  async resizeTerminal(sessionId: string, columns: number, rows: number): Promise<null> {
    const actor = this.#requireSession(sessionId);
    await actor.resize(columns, rows);
    this.#save(actor);
    return null;
  }

  replayTerminal(sessionId: string, afterSequence: number): TerminalReplay {
    const actor = this.#sessions.get(sessionId);
    const replay = this.#journal.replay(sessionId, afterSequence);
    return {
      historyGap: replay.historyGap,
      ...(replay.historyGap && actor === undefined
        ? {}
        : replay.historyGap
          ? { snapshot: actor?.terminalSnapshot() }
          : {}),
      events: replay.events.map((event) => ({
        sequence: event.sequence,
        data: Buffer.from(event.data).toString('utf8'),
      })),
      ...(replay.oldestSequence === undefined ? {} : { oldestSequence: replay.oldestSequence }),
      nextSequence: replay.nextSequence,
    };
  }

  #handleSessionEvent(sessionId: string, actor: SessionActor, event: SessionActorEvent): void {
    if (event.type === 'pty_output' && event.data.length > 0) {
      const journalEvent = this.#journal.append(sessionId, Buffer.from(event.data, 'utf8'));
      this.#emitTerminalOutput({
        sessionId,
        sequence: journalEvent.sequence,
        data: event.data,
      });
    }
    this.#save(actor);
    this.#emitChanged(
      this.#summary(sessionId, this.#titles.get(sessionId) ?? sessionId, actor.snapshot),
    );
    if (event.type === 'pty_exit') {
      this.#onActivityChange({ sessions: this.#sessions.activeCount, agentTasks: 0 });
    }
  }

  #save(actor: SessionActor, metadata?: SessionLaunchMetadata): void {
    this.#repositories.saveSession(actor.snapshot, metadata);
  }

  #summary(id: string, title: string, state: SessionState): SessionSummary {
    return {
      id,
      title,
      terminalType: this.#terminalTypes.get(id) ?? 'Unknown terminal',
      pty: state.pty,
      shell: state.shell,
      executionDialect: state.executionDialect,
      ...(isSessionShared(state) ? { shared: true } : {}),
    };
  }

  #emitChanged(summary: SessionSummary): void {
    this.#emitEvent({
      type: 'session.changed',
      streamId: `session:${summary.id}`,
      payload: summary,
    });
  }

  #recordAudit(input: AuditRecordInput): void {
    this.#audit?.record?.(input);
  }

  #requireSession(sessionId: string): SessionActor {
    const actor = this.#sessions.get(sessionId);
    if (actor === undefined)
      throw routerError('session_not_found', `Session ${sessionId} not found`);
    return actor;
  }
}
