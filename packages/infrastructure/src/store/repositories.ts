import type {
  AgentConversation,
  AgentTurn,
  AgentTask,
  ApprovalGrant,
  CommandTransaction,
  ConversationCompaction,
  ModelConfiguration,
  ModelItem,
  ProviderProfile,
  SessionState,
  ToolCallRecord,
} from '@synapse-term/domain';
import {
  agentConversationSchema,
  agentTurnSchema,
  agentTaskSchema,
  approvalGrantSchema,
  commandTransactionSchema,
  conversationCompactionSchema,
  modelConfigurationSchema,
  modelItemSchema,
  providerProfileSchema,
  sessionLaunchMetadataSchema,
  sessionStateSchema,
  toolCallRecordSchema,
  type SessionLaunchMetadata,
} from '@synapse-term/protocol';
import type { DatabaseSync } from 'node:sqlite';

import type { SqliteStore } from './sqlite-store.js';

export interface AuditEvent {
  id: string;
  actor:
    | { kind: 'user' | 'system' }
    | { kind: 'agent'; taskId: string }
    | { kind: 'external'; callerKind: 'mcp' | 'acp'; callerId: string };
  sessionId?: string | undefined;
  taskId?: string | undefined;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface AuditEventPageFilter {
  from?: string;
  to?: string;
  sessionId?: string;
  taskId?: string;
  limit?: number;
  cursor?: string;
}

export interface AuditEventPage {
  items: AuditEvent[];
  nextCursor?: string;
}

export class CoreRepositories {
  readonly #store: SqliteStore;

  constructor(store: SqliteStore) {
    this.#store = store;
  }

  saveSession(state: SessionState, metadata?: SessionLaunchMetadata): void {
    const value = sessionStateSchema.parse(state);
    const parsedMetadata =
      metadata === undefined ? undefined : sessionLaunchMetadataSchema.parse(metadata);
    this.#store.transaction((database) => {
      const createdAt = parsedMetadata?.createdAt ?? this.#nextSessionCreatedAt(database);
      if (parsedMetadata === undefined) {
        database
          .prepare(
            `INSERT INTO sessions (id, state_json, execution_dialect, created_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               state_json = excluded.state_json,
               execution_dialect = excluded.execution_dialect`,
          )
          .run(value.id, JSON.stringify(value), value.executionDialect, createdAt);
        return;
      }
      database
        .prepare(
          `INSERT INTO sessions
             (id, state_json, title, launch_json, execution_dialect, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             state_json = excluded.state_json,
             title = excluded.title,
             launch_json = excluded.launch_json,
             execution_dialect = excluded.execution_dialect,
             created_at = COALESCE(sessions.created_at, excluded.created_at)`,
        )
        .run(
          value.id,
          JSON.stringify(value),
          parsedMetadata.title,
          JSON.stringify(parsedMetadata.launch),
          value.executionDialect,
          createdAt,
        );
    });
  }

  renameSession(id: string, title: string): boolean {
    const normalized = title.trim();
    if (normalized.length === 0) throw new Error('Session alias must not be blank');
    return this.#store.transaction((database) => {
      const result = database
        .prepare('UPDATE sessions SET title = ? WHERE id = ?')
        .run(normalized, id);
      return Number(result.changes) > 0;
    });
  }

  saveAgentConversation(conversation: AgentConversation): void {
    const value = agentConversationSchema.parse(conversation);
    this.#store.transaction((database) => {
      database
        .prepare(
          `INSERT INTO agent_conversations (id, session_id, state_json) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             session_id = excluded.session_id,
             state_json = excluded.state_json`,
        )
        .run(value.id, value.sessionId, JSON.stringify(value));
    });
  }

  getAgentConversation(id: string): AgentConversation | undefined {
    return this.#getJson('agent_conversations', id, agentConversationSchema.parse) as
      AgentConversation | undefined;
  }

  listAgentConversations(sessionId?: string): AgentConversation[] {
    return this.#listJson(
      'agent_conversations',
      agentConversationSchema.parse,
      sessionId === undefined ? undefined : ['session_id', sessionId],
    ) as AgentConversation[];
  }

  saveAgentTurn(turn: AgentTurn): void {
    const value = agentTurnSchema.parse(turn);
    const model = value.model;
    this.#store.transaction((database) => {
      database
        .prepare(
          `INSERT INTO agent_turns
            (id, conversation_id, session_id, provider_profile_id, model_configuration_id, state_json)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             conversation_id = excluded.conversation_id,
             session_id = excluded.session_id,
             provider_profile_id = excluded.provider_profile_id,
             model_configuration_id = excluded.model_configuration_id,
             state_json = excluded.state_json`,
        )
        .run(
          value.id,
          value.conversationId,
          value.sessionId,
          model?.providerProfileId ?? null,
          model?.modelConfigurationId ?? null,
          JSON.stringify(value),
        );
    });
  }

  getAgentTurn(id: string): AgentTurn | undefined {
    return this.#getJson('agent_turns', id, agentTurnSchema.parse) as AgentTurn | undefined;
  }

  listAgentTurns(conversationId?: string): AgentTurn[] {
    const database: DatabaseSync = this.#store.database();
    const rows =
      conversationId === undefined
        ? database.prepare('SELECT state_json FROM agent_turns ORDER BY rowid ASC').all()
        : database
            .prepare(
              'SELECT state_json FROM agent_turns WHERE conversation_id = ? ORDER BY rowid ASC',
            )
            .all(conversationId);
    return (rows as Array<{ state_json: string }>).map((row) =>
      agentTurnSchema.parse(JSON.parse(row.state_json)),
    );
  }

  saveModelItem(item: ModelItem): void {
    const value = modelItemSchema.parse(item);
    this.#store.transaction((database) => {
      database
        .prepare(
          `INSERT INTO model_items (id, conversation_id, turn_id, sequence, state_json)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             conversation_id = excluded.conversation_id,
             turn_id = excluded.turn_id,
             sequence = excluded.sequence,
             state_json = excluded.state_json`,
        )
        .run(value.id, value.conversationId, value.turnId, value.sequence, JSON.stringify(value));
    });
  }

  listModelItems(conversationId: string): ModelItem[] {
    const rows = this.#store
      .database()
      .prepare(
        `SELECT state_json FROM model_items
         WHERE conversation_id = ? ORDER BY sequence ASC, id ASC`,
      )
      .all(conversationId) as Array<{ state_json: string }>;
    return rows.map((row) => modelItemSchema.parse(JSON.parse(row.state_json)));
  }

  saveConversationCompaction(compaction: ConversationCompaction): void {
    const value = conversationCompactionSchema.parse(compaction);
    this.#store.transaction((database) => {
      database
        .prepare(
          `INSERT INTO conversation_compactions
            (id, conversation_id, through_sequence, state_json)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             conversation_id = excluded.conversation_id,
             through_sequence = excluded.through_sequence,
             state_json = excluded.state_json`,
        )
        .run(value.id, value.conversationId, value.throughSequence, JSON.stringify(value));
    });
  }

  getConversationCompaction(id: string): ConversationCompaction | undefined {
    return this.#getJson('conversation_compactions', id, conversationCompactionSchema.parse) as
      ConversationCompaction | undefined;
  }

  listConversationCompactions(conversationId: string): ConversationCompaction[] {
    const rows = this.#store
      .database()
      .prepare(
        `SELECT state_json FROM conversation_compactions
         WHERE conversation_id = ? ORDER BY through_sequence ASC, id ASC`,
      )
      .all(conversationId) as Array<{ state_json: string }>;
    return rows.map((row) => conversationCompactionSchema.parse(JSON.parse(row.state_json)));
  }

  saveToolCall(call: ToolCallRecord): void {
    const value = toolCallRecordSchema.parse(call);
    this.#store.transaction((database) => {
      database
        .prepare(
          `INSERT INTO tool_calls (id, conversation_id, turn_id, state_json)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             conversation_id = excluded.conversation_id,
             turn_id = excluded.turn_id,
             state_json = excluded.state_json`,
        )
        .run(value.id, value.conversationId, value.turnId, JSON.stringify(value));
    });
  }

  getToolCall(id: string): ToolCallRecord | undefined {
    return this.#getJson('tool_calls', id, toolCallRecordSchema.parse) as
      ToolCallRecord | undefined;
  }

  listToolCalls(turnId: string): ToolCallRecord[] {
    return this.#listJson('tool_calls', toolCallRecordSchema.parse, [
      'turn_id',
      turnId,
    ]) as ToolCallRecord[];
  }

  getSession(id: string): SessionState | undefined {
    return this.#getJson('sessions', id, sessionStateSchema.parse) as SessionState | undefined;
  }

  listSessions(): SessionState[] {
    const rows = this.#store
      .database()
      .prepare(
        'SELECT state_json FROM sessions ORDER BY COALESCE(created_at, rowid) ASC, rowid ASC',
      )
      .all() as Array<{ state_json: string }>;
    return rows.map((row) => sessionStateSchema.parse(JSON.parse(row.state_json)));
  }

  listSessionMetadata(): Array<{ id: string; metadata: SessionLaunchMetadata }> {
    const rows = this.#store
      .database()
      .prepare(
        `SELECT id, title, launch_json, COALESCE(created_at, rowid) AS created_at
         FROM sessions
         WHERE title IS NOT NULL AND launch_json IS NOT NULL
         ORDER BY COALESCE(created_at, rowid) ASC, rowid ASC`,
      )
      .all() as Array<{ id: string; title: string; launch_json: string; created_at: number }>;
    return rows.map((row) => ({
      id: row.id,
      metadata: sessionLaunchMetadataSchema.parse({
        title: row.title,
        createdAt: row.created_at,
        launch: JSON.parse(row.launch_json),
      }),
    }));
  }

  deleteSession(id: string): boolean {
    return this.#store.transaction((database) => {
      const result = database.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      return Number(result.changes) > 0;
    });
  }

  saveAgentTask(state: AgentTask): void {
    const value = agentTaskSchema.parse(state);
    this.#store.transaction((database) => {
      database
        .prepare(
          `INSERT INTO agent_tasks (id, session_id, provider_profile_id, state_json)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             session_id = excluded.session_id,
             provider_profile_id = excluded.provider_profile_id,
             state_json = excluded.state_json`,
        )
        .run(value.id, value.sessionId, value.providerProfileId ?? null, JSON.stringify(value));
    });
  }

  getAgentTask(id: string): AgentTask | undefined {
    return this.#getJson('agent_tasks', id, agentTaskSchema.parse) as AgentTask | undefined;
  }

  listAgentTasks(sessionId?: string): AgentTask[] {
    return this.#listJson(
      'agent_tasks',
      agentTaskSchema.parse,
      sessionId === undefined ? undefined : ['session_id', sessionId],
    ) as AgentTask[];
  }

  saveCommandTransaction(state: CommandTransaction): void {
    const value = commandTransactionSchema.parse(state);
    this.#store.transaction((database) => {
      database
        .prepare(
          `INSERT INTO command_transactions (id, session_id, task_id, state_json)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             session_id = excluded.session_id,
             task_id = excluded.task_id,
             state_json = excluded.state_json`,
        )
        .run(value.id, value.sessionId, value.taskId, JSON.stringify(value));
    });
  }

  getCommandTransaction(id: string): CommandTransaction | undefined {
    return this.#getJson('command_transactions', id, commandTransactionSchema.parse) as
      CommandTransaction | undefined;
  }

  saveApprovalGrant(grant: ApprovalGrant): void {
    const value = approvalGrantSchema.parse(grant);
    this.#store.transaction((database) => {
      database
        .prepare(
          `INSERT INTO approval_grants (id, session_id, task_id, state_json)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             session_id = excluded.session_id,
             task_id = excluded.task_id,
             state_json = excluded.state_json`,
        )
        .run(value.id, value.sessionId, value.taskId, JSON.stringify(value));
    });
  }

  getApprovalGrant(id: string): ApprovalGrant | undefined {
    return this.#getJson('approval_grants', id, approvalGrantSchema.parse) as
      ApprovalGrant | undefined;
  }

  saveProviderProfile(profile: ProviderProfile): void {
    const value = providerProfileSchema.parse(profile);
    this.#upsertJson('provider_profiles', value.id, value);
  }

  getProviderProfile(id: string): ProviderProfile | undefined {
    return this.#getJson('provider_profiles', id, providerProfileSchema.parse) as
      ProviderProfile | undefined;
  }

  listProviderProfiles(): ProviderProfile[] {
    return this.#listJson('provider_profiles', providerProfileSchema.parse) as ProviderProfile[];
  }

  deleteProviderProfile(id: string): boolean {
    return this.#store.transaction((database) => {
      const result = database.prepare('DELETE FROM provider_profiles WHERE id = ?').run(id);
      return Number(result.changes) > 0;
    });
  }

  saveModelConfiguration(model: ModelConfiguration): void {
    const value = modelConfigurationSchema.parse(model);
    this.#store.transaction((database) => {
      database
        .prepare(
          `INSERT INTO model_configurations
            (id, provider_profile_id, model_id, state_json)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             provider_profile_id = excluded.provider_profile_id,
             model_id = excluded.model_id,
             state_json = excluded.state_json`,
        )
        .run(value.id, value.providerProfileId, value.modelId, JSON.stringify(value));
    });
  }

  getModelConfiguration(id: string): ModelConfiguration | undefined {
    return this.#getJson('model_configurations', id, modelConfigurationSchema.parse) as
      ModelConfiguration | undefined;
  }

  listModelConfigurations(providerProfileId?: string): ModelConfiguration[] {
    return this.#listJson(
      'model_configurations',
      modelConfigurationSchema.parse,
      providerProfileId === undefined ? undefined : ['provider_profile_id', providerProfileId],
    ) as ModelConfiguration[];
  }

  deleteModelConfiguration(id: string): boolean {
    return this.#store.transaction((database) => {
      const result = database.prepare('DELETE FROM model_configurations WHERE id = ?').run(id);
      return Number(result.changes) > 0;
    });
  }

  appendAuditEvent(event: AuditEvent): void {
    this.#store.transaction((database) => {
      database
        .prepare(
          `INSERT INTO audit_events
            (id, actor_json, session_id, task_id, type, occurred_at, payload_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.id,
          JSON.stringify(event.actor),
          event.sessionId ?? null,
          event.taskId ?? null,
          event.type,
          event.occurredAt,
          JSON.stringify(event.payload),
        );
    });
  }

  listAuditEvents(): AuditEvent[] {
    const rows = this.#store
      .database()
      .prepare(
        `SELECT id, actor_json, session_id, task_id, type, occurred_at, payload_json
         FROM audit_events ORDER BY occurred_at ASC, id ASC`,
      )
      .all() as Array<Record<string, string | null>>;
    return rows.map((row) => ({
      id: row.id!,
      actor: JSON.parse(row.actor_json!) as AuditEvent['actor'],
      sessionId: row.session_id ?? undefined,
      taskId: row.task_id ?? undefined,
      type: row.type!,
      occurredAt: row.occurred_at!,
      payload: JSON.parse(row.payload_json!) as Record<string, unknown>,
    }));
  }

  listAuditEventsPage(filter: AuditEventPageFilter = {}): AuditEventPage {
    const limit = normalizeAuditLimit(filter.limit);
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    if (filter.from !== undefined) {
      clauses.push('occurred_at >= ?');
      parameters.push(filter.from);
    }
    if (filter.to !== undefined) {
      clauses.push('occurred_at <= ?');
      parameters.push(filter.to);
    }
    if (filter.sessionId !== undefined) {
      clauses.push('session_id = ?');
      parameters.push(filter.sessionId);
    }
    if (filter.taskId !== undefined) {
      clauses.push('task_id = ?');
      parameters.push(filter.taskId);
    }
    if (filter.cursor !== undefined) {
      const cursor = decodeAuditCursor(filter.cursor);
      clauses.push('(occurred_at > ? OR (occurred_at = ? AND id > ?))');
      parameters.push(cursor.occurredAt, cursor.occurredAt, cursor.id);
    }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
    const rows = this.#store
      .database()
      .prepare(
        `SELECT id, actor_json, session_id, task_id, type, occurred_at, payload_json
         FROM audit_events ${where}
         ORDER BY occurred_at ASC, id ASC
         LIMIT ?`,
      )
      .all(...parameters, limit + 1) as Array<Record<string, string | null>>;
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = pageRows.map((row) => ({
      id: row.id!,
      actor: JSON.parse(row.actor_json!) as AuditEvent['actor'],
      sessionId: row.session_id ?? undefined,
      taskId: row.task_id ?? undefined,
      type: row.type!,
      occurredAt: row.occurred_at!,
      payload: JSON.parse(row.payload_json!) as Record<string, unknown>,
    }));
    const last = items.at(-1);
    return {
      items,
      ...(hasMore && last === undefined ? {} : {}),
      ...(hasMore && last !== undefined
        ? { nextCursor: encodeAuditCursor({ occurredAt: last.occurredAt, id: last.id }) }
        : {}),
    };
  }

  deleteAuditEventsBefore(cutoff: string): number {
    return this.#store.transaction((database) => {
      const result = database.prepare('DELETE FROM audit_events WHERE occurred_at < ?').run(cutoff);
      return Number(result.changes);
    });
  }

  #upsertJson(table: 'sessions' | 'provider_profiles', id: string, value: unknown): void {
    this.#store.transaction((database) => {
      database
        .prepare(
          `INSERT INTO ${table} (id, state_json) VALUES (?, ?)
           ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json`,
        )
        .run(id, JSON.stringify(value));
    });
  }

  #nextSessionCreatedAt(database: DatabaseSync): number {
    const row = database
      .prepare('SELECT COALESCE(MAX(COALESCE(created_at, rowid)), 0) AS latest FROM sessions')
      .get() as { latest?: number | bigint } | undefined;
    const latest = row?.latest === undefined ? 0 : Number(row.latest);
    return latest + 1;
  }

  #getJson(
    table:
      | 'sessions'
      | 'agent_conversations'
      | 'agent_turns'
      | 'agent_tasks'
      | 'conversation_compactions'
      | 'command_transactions'
      | 'approval_grants'
      | 'provider_profiles'
      | 'model_configurations'
      | 'tool_calls',
    id: string,
    parse: (value: unknown) => unknown,
  ): unknown {
    const row = this.#store
      .database()
      .prepare(`SELECT state_json FROM ${table} WHERE id = ?`)
      .get(id) as { state_json?: string } | undefined;
    return row?.state_json === undefined ? undefined : parse(JSON.parse(row.state_json));
  }

  #listJson(
    table:
      | 'sessions'
      | 'agent_conversations'
      | 'agent_turns'
      | 'agent_tasks'
      | 'conversation_compactions'
      | 'provider_profiles'
      | 'model_configurations'
      | 'tool_calls',
    parse: (value: unknown) => unknown,
    filter?: readonly [
      column: 'session_id' | 'conversation_id' | 'turn_id' | 'provider_profile_id',
      value: string,
    ],
  ): unknown[] {
    const database: DatabaseSync = this.#store.database();
    const rows =
      filter === undefined
        ? database.prepare(`SELECT state_json FROM ${table} ORDER BY id ASC`).all()
        : database
            .prepare(`SELECT state_json FROM ${table} WHERE ${filter[0]} = ? ORDER BY id ASC`)
            .all(filter[1]);
    return (rows as Array<{ state_json: string }>).map((row) => parse(JSON.parse(row.state_json)));
  }
}

function normalizeAuditLimit(value: number | undefined): number {
  if (value === undefined) return 200;
  if (!Number.isSafeInteger(value) || value < 1 || value > 500) {
    throw new RangeError('audit page limit must be between 1 and 500');
  }
  return value;
}

function encodeAuditCursor(cursor: { occurredAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeAuditCursor(value: string): { occurredAt: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      occurredAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.occurredAt !== 'string' || typeof parsed.id !== 'string') throw new Error();
    return { occurredAt: parsed.occurredAt, id: parsed.id };
  } catch {
    throw new RangeError('invalid audit cursor');
  }
}
