import type { SqliteMigration } from './sqlite-store.js';

export const CORE_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    migrate: (database) => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          state_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agent_tasks (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          provider_profile_id TEXT NOT NULL,
          state_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS command_transactions (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          state_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS approval_grants (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          state_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS provider_profiles (
          id TEXT PRIMARY KEY,
          state_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit_events (
          id TEXT PRIMARY KEY,
          actor_json TEXT NOT NULL,
          session_id TEXT,
          task_id TEXT,
          type TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS audit_events_order_idx
          ON audit_events (occurred_at, id);
      `);
    },
  },
  {
    version: 2,
    migrate: (database) => {
      database.exec(`
        ALTER TABLE sessions ADD COLUMN title TEXT;
        ALTER TABLE sessions ADD COLUMN launch_json TEXT;
      `);
    },
  },
  {
    version: 3,
    migrate: (database) => {
      database.exec(`
        ALTER TABLE sessions ADD COLUMN execution_dialect TEXT NOT NULL DEFAULT 'observe_only';
        CREATE TABLE IF NOT EXISTS agent_conversations (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          state_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agent_turns (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          provider_profile_id TEXT NOT NULL,
          state_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS model_items (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          state_json TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS model_items_sequence_idx
          ON model_items (conversation_id, sequence);
        CREATE TABLE IF NOT EXISTS tool_calls (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          state_json TEXT NOT NULL
        );
      `);
      const rows = database.prepare('SELECT id, state_json FROM sessions').all() as Array<{
        id: string;
        state_json: string;
      }>;
      const update = database.prepare(
        'UPDATE sessions SET state_json = ?, execution_dialect = ? WHERE id = ?',
      );
      for (const row of rows) {
        const state = JSON.parse(row.state_json) as Record<string, unknown>;
        const dialect =
          state.executionDialect === 'posix' || state.executionDialect === 'powershell'
            ? state.executionDialect
            : 'observe_only';
        update.run(JSON.stringify({ ...state, executionDialect: dialect }), dialect, row.id);
      }
    },
  },
  {
    version: 4,
    migrate: (database) => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS conversation_compactions (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          through_sequence INTEGER NOT NULL,
          state_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS conversation_compactions_order_idx
          ON conversation_compactions (conversation_id, through_sequence, id);
      `);
    },
  },
  {
    version: 5,
    migrate: (database) => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS model_configurations (
          id TEXT PRIMARY KEY,
          provider_profile_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          state_json TEXT NOT NULL,
          UNIQUE (provider_profile_id, model_id)
        );
        CREATE INDEX IF NOT EXISTS model_configurations_provider_idx
          ON model_configurations (provider_profile_id, id);
        ALTER TABLE agent_turns ADD COLUMN model_configuration_id TEXT;
      `);

      const providerRows = database
        .prepare('SELECT id, state_json FROM provider_profiles ORDER BY id ASC')
        .all() as Array<{ id: string; state_json: string }>;
      const updateProvider = database.prepare(
        'UPDATE provider_profiles SET state_json = ? WHERE id = ?',
      );
      const insertModel = database.prepare(
        `INSERT INTO model_configurations
          (id, provider_profile_id, model_id, state_json) VALUES (?, ?, ?, ?)`,
      );
      const migratedModels = new Map<
        string,
        { provider: Record<string, unknown>; model: Record<string, unknown> }
      >();
      let hasDefault = false;

      for (const row of providerRows) {
        const legacy = JSON.parse(row.state_json) as Record<string, unknown>;
        const provider = {
          id: row.id,
          name: text(legacy.name, row.id),
          protocol: providerProtocol(legacy.protocol),
          baseUrl: text(legacy.baseUrl, 'https://invalid.local/v1'),
          credentialRef: text(legacy.credentialRef, `provider:${row.id}`),
          extraHeaders: stringRecord(legacy.extraHeaders),
          timeoutMs: positiveInteger(legacy.timeoutMs, 30_000),
          revision: nonNegativeInteger(legacy.revision, 0),
        };
        updateProvider.run(JSON.stringify(provider), row.id);

        if (typeof legacy.model !== 'string' || legacy.model.trim().length === 0) continue;
        const validation = legacyModelValidation(legacy.validation);
        const enabled = validation.status === 'available';
        const isDefault = enabled && !hasDefault;
        if (isDefault) hasDefault = true;
        const supportedReasoningEfforts = reasoningEfforts(legacy.supportedReasoningEfforts);
        let defaultReasoningEffort = reasoningEffort(legacy.defaultReasoningEffort);
        if (!supportedReasoningEfforts.includes(defaultReasoningEffort)) {
          defaultReasoningEffort = supportedReasoningEfforts[0]!;
        }
        const contextWindowTokens = positiveInteger(legacy.contextWindowTokens, 128_000);
        let maxOutputTokens = positiveInteger(legacy.maxOutputTokens, 8_192);
        if (contextWindowTokens <= maxOutputTokens) {
          maxOutputTokens = Math.max(1, Math.floor(contextWindowTokens / 4));
        }
        const model = {
          id: row.id,
          name: provider.name,
          providerProfileId: row.id,
          modelId: legacy.model,
          declaredCapabilities: modelCapabilities(legacy.declaredCapabilities),
          contextWindowTokens,
          maxOutputTokens,
          autoCompact: typeof legacy.autoCompact === 'boolean' ? legacy.autoCompact : true,
          compactThresholdPercent: boundedInteger(legacy.compactThresholdPercent, 80, 50, 95),
          supportedReasoningEfforts,
          defaultReasoningEffort,
          enabled,
          isDefault,
          validation,
          revision: nonNegativeInteger(legacy.revision, 0),
        };
        insertModel.run(row.id, row.id, legacy.model, JSON.stringify(model));
        migratedModels.set(row.id, { provider, model });
      }

      const turnRows = database
        .prepare('SELECT id, provider_profile_id, state_json FROM agent_turns')
        .all() as Array<{ id: string; provider_profile_id: string; state_json: string }>;
      const updateTurn = database.prepare(
        'UPDATE agent_turns SET model_configuration_id = ?, state_json = ? WHERE id = ?',
      );
      for (const row of turnRows) {
        const migratedConfig = migratedModels.get(row.provider_profile_id);
        if (migratedConfig === undefined) continue;
        const state = JSON.parse(row.state_json) as Record<string, unknown>;
        const { provider, model } = migratedConfig;
        const validation = record(model.validation);
        const capabilities =
          validation.status === 'available'
            ? modelCapabilities(validation.capabilities)
            : modelCapabilities(model.declaredCapabilities);
        const migrated = {
          ...state,
          modelConfigurationId: model.id,
          modelConfigurationRevision: model.revision,
          modelConfigurationName: model.name,
          providerProfileRevision: provider.revision,
          providerProfileName: provider.name,
          protocol: provider.protocol,
          modelId: model.modelId,
          capabilities,
          contextWindowTokens: model.contextWindowTokens,
          maxOutputTokens: model.maxOutputTokens,
          autoCompact: model.autoCompact,
          compactThresholdPercent: model.compactThresholdPercent,
          supportedReasoningEfforts: model.supportedReasoningEfforts,
          defaultReasoningEffort: model.defaultReasoningEffort,
        } as Record<string, unknown>;
        delete migrated.model;
        updateTurn.run(String(model.id), JSON.stringify(migrated), row.id);
      }
    },
  },
  {
    version: 6,
    migrate: (database) => {
      const updateModel = database.prepare(
        'UPDATE model_configurations SET state_json = ? WHERE id = ?',
      );
      const modelRows = database
        .prepare('SELECT id, state_json FROM model_configurations')
        .all() as Array<{ id: string; state_json: string }>;
      for (const row of modelRows) {
        updateModel.run(JSON.stringify(normalizeReasoningState(row.state_json, false)), row.id);
      }

      const updateTurn = database.prepare('UPDATE agent_turns SET state_json = ? WHERE id = ?');
      const turnRows = database.prepare('SELECT id, state_json FROM agent_turns').all() as Array<{
        id: string;
        state_json: string;
      }>;
      for (const row of turnRows) {
        updateTurn.run(JSON.stringify(normalizeReasoningState(row.state_json, true)), row.id);
      }
    },
  },
  {
    version: 7,
    migrate: (database) => {
      // Migration: Mark old sessions' execution dialect as unverified hint.
      // Old sessions that were 'posix' or 'powershell' now have environment
      // verificationStatus = 'unverified' (not verified).
      // Active old transactions are marked as 'interrupted'.
      const sessionRows = database
        .prepare('SELECT id, state_json, execution_dialect FROM sessions')
        .all() as Array<{ id: string; state_json: string; execution_dialect: string }>;
      const updateSession = database.prepare('UPDATE sessions SET state_json = ? WHERE id = ?');
      for (const row of sessionRows) {
        const state = JSON.parse(row.state_json) as Record<string, unknown>;
        // Add environment field if missing (old sessions won't have it)
        if (state.environment === undefined) {
          const dialect = row.execution_dialect;
          const hintDialect =
            dialect === 'posix' || dialect === 'powershell' ? dialect : 'observe_only';
          (state as Record<string, unknown>).environment = {
            dialect: hintDialect,
            platform: 'unknown',
            verificationStatus: 'unverified',
            capabilityEpoch: 0,
            source: 'manual_hint',
          };
        }
        // Mark active transactions as interrupted if PTY was running
        if (state.pty === 'running') {
          (state as Record<string, unknown>).pty = 'interrupted';
        }
        updateSession.run(JSON.stringify(state), row.id);
      }

      // Mark active command transactions as interrupted
      const txRows = database
        .prepare('SELECT id, state_json FROM command_transactions')
        .all() as Array<{ id: string; state_json: string }>;
      const updateTx = database.prepare(
        'UPDATE command_transactions SET state_json = ? WHERE id = ?',
      );
      for (const row of txRows) {
        const state = JSON.parse(row.state_json) as Record<string, unknown>;
        if (state.status === 'running') {
          (state as Record<string, unknown>).status = 'interrupted';
        }
        // Add transport/environment unknown markers for old records
        if (state.transportMode === undefined) {
          (state as Record<string, unknown>).transportMode = 'rejected';
        }
        if (state.environmentEpoch === undefined) {
          (state as Record<string, unknown>).environmentEpoch = -1;
        }
        updateTx.run(JSON.stringify(state), row.id);
      }

      // Add transport fields to audit_events if missing (via payload_json)
      // Old records get transport/environment "unknown" markers
      const auditRows = database
        .prepare("SELECT id, payload_json FROM audit_events WHERE type LIKE 'command.%'")
        .all() as Array<{ id: string; payload_json: string }>;
      const updateAudit = database.prepare('UPDATE audit_events SET payload_json = ? WHERE id = ?');
      for (const row of auditRows) {
        const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
        if (payload.transportMode === undefined) {
          payload.transportMode = 'unknown';
        }
        if (payload.executionDialect === undefined) {
          payload.executionDialect = 'unknown';
        }
        if (payload.environmentEpoch === undefined) {
          payload.environmentEpoch = -1;
        }
        updateAudit.run(JSON.stringify(payload), row.id);
      }
    },
  },
  {
    version: 8,
    migrate: (database) => {
      // Reconcile the v7 execution metadata with the persistence contract
      // used by the refactored desktop branch.
      const sessionRows = database.prepare('SELECT id, state_json FROM sessions').all() as Array<{
        id: string;
        state_json: string;
      }>;
      const updateSession = database.prepare('UPDATE sessions SET state_json = ? WHERE id = ?');
      for (const row of sessionRows) {
        const state = JSON.parse(row.state_json) as Record<string, unknown>;
        if (!Object.hasOwn(state, 'environment')) continue;
        delete state.environment;
        updateSession.run(JSON.stringify(state), row.id);
      }

      const transactionRows = database
        .prepare('SELECT id, state_json FROM command_transactions')
        .all() as Array<{ id: string; state_json: string }>;
      const updateTransaction = database.prepare(
        'UPDATE command_transactions SET state_json = ? WHERE id = ?',
      );
      for (const row of transactionRows) {
        const state = JSON.parse(row.state_json) as Record<string, unknown>;
        let changed = false;
        for (const field of ['transportMode', 'executionDialect', 'environmentEpoch']) {
          if (!Object.hasOwn(state, field)) continue;
          delete state[field];
          changed = true;
        }
        if (changed) updateTransaction.run(JSON.stringify(state), row.id);
      }
    },
  },
  {
    version: 9,
    migrate: (database) => {
      // 外部驱动者（MCP / ACP）的 Task / Turn 不再要求 Provider Profile：
      // 重建 agent_turns / agent_tasks 使 provider 列可空，并把旧平铺模型字段
      // 嵌套为 model 快照，为 Conversation / Turn 补齐 driver 默认值（builtin）。
      database.exec(`
        CREATE TABLE agent_turns_v9 (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          provider_profile_id TEXT,
          model_configuration_id TEXT,
          state_json TEXT NOT NULL
        );
        INSERT INTO agent_turns_v9
          (id, conversation_id, session_id, provider_profile_id, model_configuration_id, state_json)
          SELECT id, conversation_id, session_id, provider_profile_id, model_configuration_id, state_json
          FROM agent_turns;
        DROP TABLE agent_turns;
        ALTER TABLE agent_turns_v9 RENAME TO agent_turns;
      `);

      database.exec(`
        CREATE TABLE agent_tasks_v9 (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          provider_profile_id TEXT,
          state_json TEXT NOT NULL
        );
        INSERT INTO agent_tasks_v9 (id, session_id, provider_profile_id, state_json)
          SELECT id, session_id, provider_profile_id, state_json FROM agent_tasks;
        DROP TABLE agent_tasks;
        ALTER TABLE agent_tasks_v9 RENAME TO agent_tasks;
      `);

      const conversationRows = database
        .prepare('SELECT id, state_json FROM agent_conversations')
        .all() as Array<{ id: string; state_json: string }>;
      const updateConversation = database.prepare(
        'UPDATE agent_conversations SET state_json = ? WHERE id = ?',
      );
      for (const row of conversationRows) {
        const state = JSON.parse(row.state_json) as Record<string, unknown>;
        if (state.driver === undefined) {
          updateConversation.run(JSON.stringify({ ...state, driver: 'builtin' }), row.id);
        }
      }

      const turnRows = database
        .prepare(
          'SELECT id, provider_profile_id, model_configuration_id, state_json FROM agent_turns',
        )
        .all() as Array<{
        id: string;
        provider_profile_id: string | null;
        model_configuration_id: string | null;
        state_json: string;
      }>;
      const updateTurn = database.prepare(
        'UPDATE agent_turns SET provider_profile_id = ?, model_configuration_id = ?, state_json = ? WHERE id = ?',
      );
      const flatModelKeys = [
        'modelConfigurationId',
        'modelConfigurationRevision',
        'modelConfigurationName',
        'providerProfileId',
        'providerProfileRevision',
        'providerProfileName',
        'protocol',
        'modelId',
        'capabilities',
        'contextWindowTokens',
        'maxOutputTokens',
        'autoCompact',
        'compactThresholdPercent',
        'supportedReasoningEfforts',
        'defaultReasoningEffort',
      ] as const;
      for (const row of turnRows) {
        const state = JSON.parse(row.state_json) as Record<string, unknown>;
        const driver = state.driver === 'acp' ? 'acp' : 'builtin';
        let model: Record<string, unknown> | undefined;
        if (typeof state.model === 'object' && state.model !== null) {
          model = state.model as Record<string, unknown>;
        } else if (typeof state.modelConfigurationId === 'string') {
          model = {
            modelConfigurationId: state.modelConfigurationId,
            modelConfigurationRevision: state.modelConfigurationRevision,
            modelConfigurationName: state.modelConfigurationName,
            providerProfileId:
              typeof state.providerProfileId === 'string'
                ? state.providerProfileId
                : row.provider_profile_id,
            providerProfileRevision: state.providerProfileRevision,
            providerProfileName: state.providerProfileName,
            protocol: state.protocol,
            modelId: state.modelId,
            capabilities: state.capabilities,
            contextWindowTokens: state.contextWindowTokens,
            maxOutputTokens: state.maxOutputTokens,
            autoCompact: state.autoCompact,
            compactThresholdPercent: state.compactThresholdPercent,
            supportedReasoningEfforts: state.supportedReasoningEfforts,
            defaultReasoningEffort: state.defaultReasoningEffort,
          };
        }
        const next: Record<string, unknown> = { ...state };
        if (model !== undefined) {
          for (const key of flatModelKeys) delete next[key];
          next.model = model;
        }
        next.driver = driver;
        const providerProfileId = model?.providerProfileId;
        const modelConfigurationId = model?.modelConfigurationId;
        updateTurn.run(
          typeof providerProfileId === 'string' ? providerProfileId : null,
          typeof modelConfigurationId === 'string' ? modelConfigurationId : null,
          JSON.stringify(next),
          row.id,
        );
      }
    },
  },
  {
    version: 10,
    migrate: (database) => {
      database.exec(`
        ALTER TABLE sessions ADD COLUMN created_at INTEGER;
        UPDATE sessions SET created_at = rowid WHERE created_at IS NULL;
        CREATE INDEX IF NOT EXISTS sessions_created_at_idx
          ON sessions (created_at, id);
      `);
    },
  },
];

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function stringRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function positiveInteger(value: unknown, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function providerProtocol(
  value: unknown,
): 'openai_responses' | 'openai_chat_completions' | 'anthropic_messages' {
  return value === 'openai_responses' ||
    value === 'openai_chat_completions' ||
    value === 'anthropic_messages'
    ? value
    : 'openai_chat_completions';
}

function modelCapabilities(value: unknown): {
  responses: boolean;
  streaming: boolean;
  toolCalls: boolean;
  reasoning?: boolean;
  multimodal: boolean;
} {
  const input = record(value);
  return {
    responses: input.responses === true,
    streaming: input.streaming === true,
    toolCalls: input.toolCalls === true,
    ...(typeof input.reasoning === 'boolean' ? { reasoning: input.reasoning } : {}),
    multimodal: input.multimodal === true,
  };
}

function legacyModelValidation(value: unknown): Record<string, unknown> {
  const validation = record(value);
  const attempt = positiveInteger(validation.attempt, 1);
  if (validation.status === 'available' && typeof validation.checkedAt === 'string') {
    return {
      status: 'available',
      checkedAt: validation.checkedAt,
      capabilities: modelCapabilities(validation.capabilities),
      attempt,
    };
  }
  if (
    validation.status === 'unavailable' &&
    typeof validation.checkedAt === 'string' &&
    typeof validation.reason === 'string'
  ) {
    return {
      status: 'unavailable',
      checkedAt: validation.checkedAt,
      reason: validation.reason,
      attempt,
    };
  }
  return { status: 'unverified' };
}

type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

function reasoningEfforts(value: unknown): ReasoningEffort[] {
  if (!Array.isArray(value)) return ['low'];
  const allowed = value.flatMap((effort): ReasoningEffort[] => {
    if (effort === 'minimal') return ['low'];
    return effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh'
      ? [effort]
      : [];
  });
  return [...new Set<ReasoningEffort>(allowed.length > 0 ? allowed : ['low'])];
}

function reasoningEffort(value: unknown): ReasoningEffort {
  if (value === 'minimal') return 'low';
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'
    ? value
    : 'low';
}

function normalizeReasoningState(stateJson: string, includeTurnEffort: boolean): unknown {
  const state = JSON.parse(stateJson) as Record<string, unknown>;
  const supportedReasoningEfforts = reasoningEfforts(state.supportedReasoningEfforts);
  let defaultReasoningEffort = reasoningEffort(state.defaultReasoningEffort);
  if (!supportedReasoningEfforts.includes(defaultReasoningEffort)) {
    defaultReasoningEffort = supportedReasoningEfforts[0]!;
  }
  return {
    ...state,
    supportedReasoningEfforts,
    defaultReasoningEffort,
    ...(includeTurnEffort
      ? { reasoningEffort: reasoningEffort(state.reasoningEffort ?? defaultReasoningEffort) }
      : {}),
  };
}
