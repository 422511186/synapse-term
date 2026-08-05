import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createAgentConversation,
  createAgentModelSelection,
  beginModelValidation,
  createAgentTurn,
  createAgentTask,
  createApprovalGrant,
  createCommandTransaction,
  createConversationCompaction,
  createModelConfiguration,
  createModelItem,
  createProviderProfile,
  createSessionState,
  createToolCallRecord,
  finishModelValidation,
  setModelConfigurationEnabled,
} from '@synapse-term/domain';
import { withTemporaryDirectory } from '@synapse-term/test-kit';

import { CORE_MIGRATIONS } from './core-schema.js';
import { CoreRepositories } from './repositories.js';
import { SqliteStore } from './sqlite-store.js';

describe('CoreRepositories', () => {
  it('reads a bounded audit page with time, session, task, and cursor filters', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      try {
        const repositories = new CoreRepositories(store);
        const append = (event: Parameters<CoreRepositories['appendAuditEvent']>[0]): void =>
          repositories.appendAuditEvent(event);
        append({
          id: 'audit-old',
          actor: { kind: 'system' },
          sessionId: 'session-page',
          taskId: 'task-page',
          type: 'task.started',
          occurredAt: '2026-08-01T00:00:00.000Z',
          payload: {},
        });
        append({
          id: 'audit-middle',
          actor: { kind: 'system' },
          sessionId: 'session-page',
          taskId: 'task-page',
          type: 'command.completed',
          occurredAt: '2026-08-02T00:00:00.000Z',
          payload: {},
        });
        append({
          id: 'audit-other-session',
          actor: { kind: 'system' },
          sessionId: 'session-other',
          type: 'session.created',
          occurredAt: '2026-08-02T12:00:00.000Z',
          payload: {},
        });
        append({
          id: 'audit-new',
          actor: { kind: 'system' },
          sessionId: 'session-page',
          taskId: 'task-page',
          type: 'task.completed',
          occurredAt: '2026-08-03T00:00:00.000Z',
          payload: {},
        });

        const first = repositories.listAuditEventsPage({
          from: '2026-08-01T00:00:00.000Z',
          to: '2026-08-04T00:00:00.000Z',
          sessionId: 'session-page',
          taskId: 'task-page',
          limit: 2,
        });
        expect(first.items.map((event) => event.id)).toEqual(['audit-old', 'audit-middle']);
        expect(first.nextCursor).toBeDefined();

        const second = repositories.listAuditEventsPage(
          first.nextCursor === undefined
            ? { sessionId: 'session-page', taskId: 'task-page', limit: 2 }
            : {
                sessionId: 'session-page',
                taskId: 'task-page',
                limit: 2,
                cursor: first.nextCursor,
              },
        );
        expect(second.items.map((event) => event.id)).toEqual(['audit-new']);
        expect(second.nextCursor).toBeUndefined();
      } finally {
        await store.close();
      }
    });
  });

  it('lists Session metadata in creation order instead of UUID order', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      try {
        store
          .database()
          .prepare('INSERT INTO sessions (id, state_json, title, launch_json) VALUES (?, ?, ?, ?)')
          .run(
            'session-z',
            JSON.stringify(createSessionState('session-z')),
            'first',
            JSON.stringify({
              executable: 'bash',
              terminalType: 'Git Bash',
              args: [],
              cwd: 'C:/work',
              columns: 80,
              rows: 24,
              executionDialect: 'posix',
              envKeys: [],
            }),
          );
        store
          .database()
          .prepare('INSERT INTO sessions (id, state_json, title, launch_json) VALUES (?, ?, ?, ?)')
          .run(
            'session-a',
            JSON.stringify(createSessionState('session-a')),
            'second',
            JSON.stringify({
              executable: 'bash',
              terminalType: 'Git Bash',
              args: [],
              cwd: 'C:/work',
              columns: 80,
              rows: 24,
              executionDialect: 'posix',
              envKeys: [],
            }),
          );

        const repositories = new CoreRepositories(store);
        expect(repositories.listSessionMetadata().map((record) => record.id)).toEqual([
          'session-z',
          'session-a',
        ]);
      } finally {
        await store.close();
      }
    });
  });

  it('persists multiple model configurations per provider with a unique model id', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      try {
        const repositories = new CoreRepositories(store);
        expect(repositories).toMatchObject({
          saveModelConfiguration: expect.any(Function),
          getModelConfiguration: expect.any(Function),
          listModelConfigurations: expect.any(Function),
          deleteModelConfiguration: expect.any(Function),
        });
        const first = createModelConfiguration({
          id: 'model-1',
          name: 'Model 1',
          providerProfileId: 'provider-1',
          modelId: 'model-1',
          declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
        });
        const second = createModelConfiguration({
          id: 'model-2',
          name: 'Model 2',
          providerProfileId: 'provider-1',
          modelId: 'model-2',
          declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
        });

        repositories.saveModelConfiguration(first);
        repositories.saveModelConfiguration(second);
        expect(repositories.listModelConfigurations('provider-1')).toEqual([first, second]);
        expect(repositories.getModelConfiguration('model-2')).toEqual(second);
        expect(() =>
          repositories.saveModelConfiguration({ ...second, id: 'duplicate-model-id' }),
        ).toThrow();
      } finally {
        await store.close();
      }
    });
  });

  it('persists domain records and audit events across store reopen', async () => {
    await withTemporaryDirectory(async (directory) => {
      const databasePath = join(directory, 'core.sqlite');
      const session = createSessionState('session-1');
      const task = createAgentTask({
        id: 'task-1',
        sessionId: session.id,
        providerProfileId: 'provider-1',
        goal: 'Check disk usage',
      });
      const conversation = createAgentConversation({
        id: 'conversation-1',
        sessionId: session.id,
      });
      const profile = createProviderProfile({
        id: 'provider-1',
        name: 'OpenAI',
        protocol: 'openai_responses',
        baseUrl: 'https://api.openai.com/v1',
        credentialRef: 'credential:provider-1',
        extraHeaders: {},
        timeoutMs: 30_000,
      });
      const model = createModelConfiguration({
        id: 'model-1',
        name: 'GPT-5',
        providerProfileId: profile.id,
        modelId: 'gpt-5',
        declaredCapabilities: { responses: true, streaming: true, toolCalls: true },
      });
      const validating = beginModelValidation(model);
      if (!validating.ok) throw new Error('expected validation to start');
      const available = finishModelValidation(validating.value, {
        status: 'available',
        checkedAt: '2026-07-28T10:00:00.000Z',
        capabilities: { responses: true, streaming: true, toolCalls: true },
      });
      if (!available.ok) throw new Error('expected validation to finish');
      const enabled = setModelConfigurationEnabled(available.value, true);
      if (!enabled.ok) throw new Error('expected model to enable');
      const turn = createAgentTurn({
        id: 'turn-1',
        conversationId: conversation.id,
        sessionId: session.id,
        model: createAgentModelSelection(profile, enabled.value),
        userMessage: '检查磁盘',
      });
      const modelItem = createModelItem({
        id: 'item-1',
        conversationId: conversation.id,
        turnId: turn.id,
        sequence: 0,
        type: 'user_text',
        content: turn.userMessage,
      });
      const compaction = createConversationCompaction({
        id: 'compaction-1',
        conversationId: conversation.id,
        throughSequence: 0,
        summary: '用户要求检查磁盘。',
        sourceItemCount: 1,
        estimatedTokensBefore: 1_200,
        createdAt: '2026-07-28T00:00:00.000Z',
      });
      const toolCall = createToolCallRecord({
        id: 'call-1',
        conversationId: conversation.id,
        turnId: turn.id,
        name: 'terminal_observe',
        argumentsJson: '{}',
      });
      const transaction = createCommandTransaction({
        id: 'transaction-1',
        sessionId: session.id,
        taskId: task.id,
        command: 'df -h',
        nonce: 'nonce-1',
      });
      const grant = createApprovalGrant({
        id: 'grant-1',
        sessionId: session.id,
        taskId: task.id,
        commands: [
          {
            sequence: 0,
            command: 'systemctl status api',
            commandHash: 'sha256:command',
            risk: { level: 'read_only', reasons: ['reads status'] },
          },
        ],
        grantedAt: '2026-07-27T15:00:00.000Z',
      });
      const firstStore = new SqliteStore(databasePath, CORE_MIGRATIONS);
      await firstStore.open();
      const first = new CoreRepositories(firstStore);
      first.saveSession(session);
      first.saveProviderProfile(profile);
      first.saveModelConfiguration(enabled.value);
      expect(() =>
        first.saveProviderProfile({ ...profile, apiKey: 'secret' } as typeof profile & {
          apiKey: string;
        }),
      ).toThrow();
      first.saveAgentTask(task);
      first.saveAgentConversation(conversation);
      first.saveAgentTurn(turn);
      first.saveModelItem(modelItem);
      first.saveConversationCompaction(compaction);
      first.saveToolCall(toolCall);
      first.saveCommandTransaction(transaction);
      first.saveApprovalGrant(grant);
      first.appendAuditEvent({
        id: 'audit-1',
        actor: { kind: 'agent', taskId: task.id },
        sessionId: session.id,
        taskId: task.id,
        type: 'command.requested',
        occurredAt: '2026-07-27T15:00:00.000Z',
        payload: { commandHash: 'sha256:command' },
      });
      await firstStore.close();

      const secondStore = new SqliteStore(databasePath, CORE_MIGRATIONS);
      await secondStore.open();
      const second = new CoreRepositories(secondStore);
      expect(second.getSession(session.id)).toEqual(session);
      expect(second.getProviderProfile(profile.id)).toEqual(profile);
      expect(second.getModelConfiguration(model.id)).toEqual(enabled.value);
      expect(second.getAgentTask(task.id)).toEqual(task);
      expect(second.getAgentConversation(conversation.id)).toEqual(conversation);
      expect(second.listAgentConversations(session.id)).toEqual([conversation]);
      expect(second.getAgentTurn(turn.id)).toEqual(turn);
      expect(second.listAgentTurns(conversation.id)).toEqual([turn]);
      expect(second.listModelItems(conversation.id)).toEqual([modelItem]);
      expect(second.getConversationCompaction(compaction.id)).toEqual(compaction);
      expect(second.listConversationCompactions(conversation.id)).toEqual([compaction]);
      expect(second.getToolCall(toolCall.id)).toEqual(toolCall);
      expect(second.listToolCalls(turn.id)).toEqual([toolCall]);
      expect(second.getCommandTransaction(transaction.id)).toEqual(transaction);
      expect(second.getApprovalGrant(grant.id)).toEqual(grant);
      expect(second.listAuditEvents()).toHaveLength(1);
      await secondStore.close();
    });
  });

  it('lists Agent Turns in insertion order instead of random id order', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      try {
        const repositories = new CoreRepositories(store);
        const conversation = createAgentConversation({
          id: 'conversation-order',
          sessionId: 'session-order',
        });
        const profile = createProviderProfile({
          id: 'provider-order',
          name: 'Provider',
          protocol: 'openai_chat_completions',
          baseUrl: 'https://example.test/v1',
          credentialRef: 'provider:provider-order',
          extraHeaders: {},
          timeoutMs: 30_000,
        });
        const created = createModelConfiguration({
          id: 'model-order',
          name: 'Model',
          providerProfileId: profile.id,
          modelId: 'model-order',
          declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
        });
        const validating = beginModelValidation(created);
        if (!validating.ok) throw new Error('expected validation to start');
        const available = finishModelValidation(validating.value, {
          status: 'available',
          checkedAt: '2026-07-28T10:00:00.000Z',
          capabilities: created.declaredCapabilities,
        });
        if (!available.ok) throw new Error('expected validation to finish');
        const enabled = setModelConfigurationEnabled(available.value, true);
        if (!enabled.ok) throw new Error('expected model to enable');
        const selection = createAgentModelSelection(profile, enabled.value);

        repositories.saveAgentConversation(conversation);
        repositories.saveAgentTurn(
          createAgentTurn({
            id: 'turn-z',
            conversationId: conversation.id,
            sessionId: conversation.sessionId,
            model: selection,
            userMessage: 'first',
          }),
        );
        repositories.saveAgentTurn(
          createAgentTurn({
            id: 'turn-a',
            conversationId: conversation.id,
            sessionId: conversation.sessionId,
            model: selection,
            userMessage: 'second',
          }),
        );

        expect(repositories.listAgentTurns(conversation.id).map((turn) => turn.id)).toEqual([
          'turn-z',
          'turn-a',
        ]);
      } finally {
        await store.close();
      }
    });
  });

  it('migrates v0.1 session data to the current schema without losing legacy tasks', async () => {
    await withTemporaryDirectory(async (directory) => {
      const databasePath = join(directory, 'core.sqlite');
      const legacy = new SqliteStore(databasePath, CORE_MIGRATIONS.slice(0, 2));
      await legacy.open();
      const repositories = new CoreRepositories(legacy);
      const legacySession = createSessionState('session-legacy');
      const { executionDialect: _dialect, ...legacyState } = legacySession;
      void _dialect;
      legacy
        .database()
        .prepare('INSERT INTO sessions (id, state_json, title, launch_json) VALUES (?, ?, ?, ?)')
        .run(
          legacySession.id,
          JSON.stringify(legacyState),
          'legacy',
          JSON.stringify({
            executable: 'powershell.exe',
            args: [],
            cwd: 'C:/work',
            columns: 80,
            rows: 24,
            envKeys: [],
          }),
        );
      const legacyTask = createAgentTask({
        id: 'task-legacy',
        sessionId: legacySession.id,
        providerProfileId: 'provider-1',
        goal: 'legacy goal',
      });
      repositories.saveAgentTask(legacyTask);
      await legacy.close();

      const upgraded = new SqliteStore(databasePath, CORE_MIGRATIONS);
      await upgraded.open();
      try {
        expect(upgraded.schemaVersion).toBe(11);
        const upgradedRepositories = new CoreRepositories(upgraded);
        expect(upgradedRepositories.getSession(legacySession.id)).toMatchObject({
          executionDialect: 'observe_only',
        });
        expect(upgradedRepositories.getAgentTask(legacyTask.id)).toEqual(legacyTask);
        expect(
          upgraded.database().prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'agent_conversations' }),
            expect.objectContaining({ name: 'agent_turns' }),
            expect.objectContaining({ name: 'model_items' }),
            expect.objectContaining({ name: 'tool_calls' }),
            expect.objectContaining({ name: 'conversation_compactions' }),
            expect.objectContaining({ name: 'model_configurations' }),
          ]),
        );
      } finally {
        await upgraded.close();
      }
    });
  });

  it('splits legacy provider model settings into a model configuration', async () => {
    await withTemporaryDirectory(async (directory) => {
      const databasePath = join(directory, 'core.sqlite');
      const legacy = new SqliteStore(databasePath, CORE_MIGRATIONS.slice(0, 4));
      await legacy.open();
      legacy
        .database()
        .prepare('INSERT INTO provider_profiles (id, state_json) VALUES (?, ?)')
        .run(
          'provider-legacy',
          JSON.stringify({
            id: 'provider-legacy',
            name: 'Legacy Model',
            protocol: 'openai_chat_completions',
            baseUrl: 'http://127.0.0.1:5090/v1',
            model: 'mimo-v2.5-pro',
            credentialRef: 'provider:provider-legacy',
            extraHeaders: {},
            timeoutMs: 30_000,
            declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
            contextWindowTokens: 128_000,
            maxOutputTokens: 4_096,
            autoCompact: true,
            compactThresholdPercent: 80,
            supportedReasoningEfforts: ['minimal'],
            defaultReasoningEffort: 'minimal',
            validation: {
              status: 'available',
              checkedAt: '2026-07-28T10:00:00.000Z',
              capabilities: { responses: false, streaming: true, toolCalls: true },
              attempt: 2,
            },
            revision: 4,
          }),
        );
      await legacy.close();

      const upgraded = new SqliteStore(databasePath, CORE_MIGRATIONS);
      await upgraded.open();
      try {
        const repositories = new CoreRepositories(upgraded);
        expect(repositories.getProviderProfile('provider-legacy')).toEqual({
          id: 'provider-legacy',
          name: 'Legacy Model',
          protocol: 'openai_chat_completions',
          baseUrl: 'http://127.0.0.1:5090/v1',
          credentialRef: 'provider:provider-legacy',
          extraHeaders: {},
          timeoutMs: 30_000,
          revision: 4,
        });
        expect(repositories.getModelConfiguration('provider-legacy')).toMatchObject({
          id: 'provider-legacy',
          providerProfileId: 'provider-legacy',
          name: 'Legacy Model',
          modelId: 'mimo-v2.5-pro',
          maxOutputTokens: 4_096,
          enabled: true,
          isDefault: true,
          validation: { status: 'available', attempt: 2 },
        });
      } finally {
        await upgraded.close();
      }
    });
  });

  it('migrates persisted minimal reasoning effort to low', async () => {
    await withTemporaryDirectory(async (directory) => {
      const databasePath = join(directory, 'core.sqlite');
      const legacy = new SqliteStore(databasePath, CORE_MIGRATIONS.slice(0, 5));
      await legacy.open();
      legacy
        .database()
        .prepare(
          `INSERT INTO model_configurations
            (id, provider_profile_id, model_id, state_json) VALUES (?, ?, ?, ?)`,
        )
        .run(
          'model-legacy-reasoning',
          'provider-1',
          'model-1',
          JSON.stringify({
            id: 'model-legacy-reasoning',
            supportedReasoningEfforts: ['minimal', 'high'],
            defaultReasoningEffort: 'minimal',
          }),
        );
      legacy
        .database()
        .prepare(
          `INSERT INTO agent_turns
            (id, conversation_id, session_id, provider_profile_id, model_configuration_id, state_json)
            VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'turn-legacy-reasoning',
          'conversation-1',
          'session-1',
          'provider-1',
          'model-legacy-reasoning',
          JSON.stringify({
            id: 'turn-legacy-reasoning',
            supportedReasoningEfforts: ['minimal', 'medium'],
            defaultReasoningEffort: 'minimal',
            reasoningEffort: 'minimal',
          }),
        );
      await legacy.close();

      const upgraded = new SqliteStore(databasePath, CORE_MIGRATIONS);
      await upgraded.open();
      try {
        expect(upgraded.schemaVersion).toBe(11);
        const modelRow = upgraded
          .database()
          .prepare('SELECT state_json FROM model_configurations WHERE id = ?')
          .get('model-legacy-reasoning') as { state_json: string };
        const turnRow = upgraded
          .database()
          .prepare('SELECT state_json FROM agent_turns WHERE id = ?')
          .get('turn-legacy-reasoning') as { state_json: string };

        expect(JSON.parse(modelRow.state_json)).toMatchObject({
          supportedReasoningEfforts: ['low', 'high'],
          defaultReasoningEffort: 'low',
        });
        expect(JSON.parse(turnRow.state_json)).toMatchObject({
          driver: 'builtin',
          supportedReasoningEfforts: ['low', 'medium'],
          defaultReasoningEffort: 'low',
          reasoningEffort: 'low',
        });
      } finally {
        await upgraded.close();
      }
    });
  });

  it('persists external driver tasks and turns without provider or model selection', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      try {
        const repositories = new CoreRepositories(store);
        const session = createSessionState('session-external');
        const conversation = createAgentConversation({
          id: 'conversation-external',
          sessionId: session.id,
          driver: 'acp',
        });
        const task = createAgentTask({
          id: 'task-external',
          sessionId: session.id,
          goal: 'Check disk usage',
        });
        const turn = createAgentTurn({
          id: 'turn-external',
          conversationId: conversation.id,
          sessionId: session.id,
          driver: 'acp',
          permissionMode: 'manual',
          userMessage: '检查磁盘',
        });

        repositories.saveSession(session);
        repositories.saveAgentConversation(conversation);
        repositories.saveAgentTask(task);
        repositories.saveAgentTurn(turn);

        expect(repositories.getAgentTask(task.id)).toEqual(task);
        expect(repositories.getAgentTurn(turn.id)).toEqual(turn);
        expect(repositories.listAgentConversations(session.id)[0]?.driver).toBe('acp');
        const turnRow = store
          .database()
          .prepare(
            'SELECT provider_profile_id, model_configuration_id FROM agent_turns WHERE id = ?',
          )
          .get(turn.id) as { provider_profile_id: unknown; model_configuration_id: unknown };
        expect(turnRow.provider_profile_id).toBeNull();
        expect(turnRow.model_configuration_id).toBeNull();
        const taskRow = store
          .database()
          .prepare('SELECT provider_profile_id FROM agent_tasks WHERE id = ?')
          .get(task.id) as { provider_profile_id: unknown };
        expect(taskRow.provider_profile_id).toBeNull();
      } finally {
        await store.close();
      }
    });
  });

  it('migrates legacy flat turns into nested model selections and defaults conversation driver', async () => {
    await withTemporaryDirectory(async (directory) => {
      const databasePath = join(directory, 'core.sqlite');
      const legacy = new SqliteStore(databasePath, CORE_MIGRATIONS.slice(0, 8));
      await legacy.open();
      legacy
        .database()
        .prepare(`INSERT INTO agent_conversations (id, session_id, state_json) VALUES (?, ?, ?)`)
        .run(
          'conversation-legacy',
          'session-legacy',
          JSON.stringify({
            id: 'conversation-legacy',
            sessionId: 'session-legacy',
            status: 'active',
            permissionMode: 'auto',
            revision: 0,
          }),
        );
      legacy
        .database()
        .prepare(
          `INSERT INTO agent_turns
            (id, conversation_id, session_id, provider_profile_id, model_configuration_id, state_json)
            VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'turn-legacy-flat',
          'conversation-legacy',
          'session-legacy',
          'provider-1',
          'model-1',
          JSON.stringify({
            id: 'turn-legacy-flat',
            conversationId: 'conversation-legacy',
            sessionId: 'session-legacy',
            modelConfigurationId: 'model-1',
            modelConfigurationRevision: 3,
            modelConfigurationName: 'GPT-5.1',
            providerProfileId: 'provider-1',
            providerProfileRevision: 3,
            providerProfileName: 'OpenAI',
            protocol: 'openai_responses',
            modelId: 'gpt-5.1',
            capabilities: { responses: true, streaming: true, toolCalls: true },
            contextWindowTokens: 128_000,
            maxOutputTokens: 8_192,
            autoCompact: true,
            compactThresholdPercent: 80,
            supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
            defaultReasoningEffort: 'medium',
            reasoningEffort: 'medium',
            permissionMode: 'auto',
            userMessage: '检查磁盘',
            status: 'completed',
            revision: 2,
          }),
        );
      await legacy.close();

      const upgraded = new SqliteStore(databasePath, CORE_MIGRATIONS);
      await upgraded.open();
      try {
        expect(upgraded.schemaVersion).toBe(11);
        const repositories = new CoreRepositories(upgraded);
        expect(repositories.getAgentConversation('conversation-legacy')).toMatchObject({
          driver: 'builtin',
        });
        expect(repositories.getAgentTurn('turn-legacy-flat')).toMatchObject({
          driver: 'builtin',
          reasoningEffort: 'medium',
          model: {
            modelConfigurationId: 'model-1',
            modelConfigurationRevision: 3,
            modelConfigurationName: 'GPT-5.1',
            providerProfileId: 'provider-1',
            providerProfileRevision: 3,
            providerProfileName: 'OpenAI',
            protocol: 'openai_responses',
            modelId: 'gpt-5.1',
            capabilities: { responses: true, streaming: true, toolCalls: true },
            contextWindowTokens: 128_000,
            maxOutputTokens: 8_192,
            autoCompact: true,
            compactThresholdPercent: 80,
            supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
            defaultReasoningEffort: 'medium',
          },
        });
        expect(repositories.getAgentTurn('turn-legacy-flat')?.model?.modelConfigurationId).toBe(
          'model-1',
        );
      } finally {
        await upgraded.close();
      }
    });
  });
});
