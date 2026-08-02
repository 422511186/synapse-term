import { describe, expect, it } from 'vitest';

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
  reasoningEffortSchema,
  sessionStateSchema,
  toolCallRecordSchema,
} from './domain-schemas.js';

describe('domain schemas', () => {
  it('accepts low through xhigh reasoning and rejects legacy minimal', () => {
    expect(reasoningEffortSchema.options).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(reasoningEffortSchema.parse('xhigh')).toBe('xhigh');
    expect(reasoningEffortSchema.safeParse('minimal').success).toBe(false);
  });

  it('parses a session state and rejects unknown fields', () => {
    const session = {
      id: 'session-1',
      pty: 'running',
      attachment: 'attached',
      shell: 'ready',
      executionDialect: 'posix',
      shellCapabilityEpoch: 1,
      lease: {
        owner: { kind: 'agent', taskId: 'task-1' },
        epoch: 2,
      },
    };

    const parsed = sessionStateSchema.parse(session);
    expect(parsed).toMatchObject(session);
    // Environment gets default value from schema when not provided
    expect(parsed.environment).toMatchObject({
      dialect: 'observe_only',
      platform: 'unknown',
      operatingSystem: 'unknown',
      verificationStatus: 'unverified',
      capabilityEpoch: 0,
    });
    expect(
      sessionStateSchema.parse({
        ...session,
        environment: {
          dialect: 'posix',
          platform: 'unix',
          verificationStatus: 'verified',
          capabilityEpoch: 4,
        },
      }).environment,
    ).toMatchObject({
      dialect: 'posix',
      platform: 'unix',
      operatingSystem: 'unknown',
      capabilityEpoch: 4,
    });
    expect(sessionStateSchema.safeParse({ ...session, serverId: 'server-1' }).success).toBe(false);
  });

  it('parses conversation, turn, structured model item, and tool call records', () => {
    const conversation = {
      id: 'conversation-1',
      sessionId: 'session-1',
      status: 'active',
      permissionMode: 'auto',
      revision: 0,
    };
    const turn = {
      id: 'turn-1',
      conversationId: conversation.id,
      sessionId: conversation.sessionId,
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
      status: 'running',
      revision: 1,
    };
    const toolItem = {
      id: 'item-1',
      conversationId: conversation.id,
      turnId: turn.id,
      sequence: 1,
      type: 'assistant_tool_call',
      toolCallId: 'call-1',
      name: 'terminal_observe',
      argumentsJson: '{}',
    };
    const call = {
      id: 'call-1',
      conversationId: conversation.id,
      turnId: turn.id,
      name: 'terminal_observe',
      argumentsJson: '{}',
      status: 'running',
      revision: 2,
    };

    expect(agentConversationSchema.parse(conversation)).toEqual(conversation);
    expect(agentTurnSchema.parse(turn)).toEqual(turn);
    expect(modelItemSchema.parse(toolItem)).toEqual(toolItem);
    expect(toolCallRecordSchema.parse(call)).toEqual(call);
    const compaction = {
      id: 'compaction-1',
      conversationId: conversation.id,
      throughSequence: 1,
      summary: '已观察终端。',
      sourceItemCount: 1,
      estimatedTokensBefore: 2_000,
      createdAt: '2026-07-28T00:00:00.000Z',
    };
    expect(conversationCompactionSchema.parse(compaction)).toEqual(compaction);
  });

  it('parses a session-bound agent task', () => {
    const task = {
      id: 'task-1',
      sessionId: 'session-1',
      providerProfileId: 'provider-1',
      goal: 'Check disk usage',
      status: 'waiting_approval',
      revision: 3,
    };

    expect(agentTaskSchema.parse(task)).toEqual(task);
    expect(agentTaskSchema.safeParse({ ...task, status: 'unknown' }).success).toBe(false);
  });

  it('requires deterministic completion metadata for a completed transaction', () => {
    const transaction = {
      id: 'transaction-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      command: 'df -h',
      nonce: 'nonce-1',
      status: 'completed',
      revision: 5,
      risk: 'read_only',
      leaseEpoch: 2,
      exitCode: 0,
    };

    expect(commandTransactionSchema.parse(transaction)).toEqual(transaction);
    const { exitCode: _exitCode, ...withoutExitCode } = transaction;
    void _exitCode;
    expect(commandTransactionSchema.safeParse(withoutExitCode).success).toBe(false);
  });

  it('parses an exact approval grant with ordered command metadata', () => {
    const grant = {
      id: 'grant-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      environmentEpoch: 7,
      commands: [
        {
          sequence: 0,
          command: 'systemctl restart api',
          commandHash: 'sha256:command-1',
          risk: { level: 'mutating', reasons: ['restarts a service'] },
        },
      ],
      grantedAt: '2026-07-27T15:00:00.000Z',
    };

    expect(approvalGrantSchema.parse(grant)).toEqual(grant);
    expect(
      approvalGrantSchema.safeParse({
        ...grant,
        commands: [{ ...grant.commands[0], sequence: -1 }],
      }).success,
    ).toBe(false);
  });

  it('parses a connection-only provider profile without accepting model or plaintext secrets', () => {
    const profile = {
      id: 'provider-1',
      name: 'Anthropic',
      protocol: 'anthropic_messages',
      baseUrl: 'https://api.anthropic.com',
      credentialRef: 'credential:provider-1',
      extraHeaders: {},
      timeoutMs: 30_000,
      revision: 2,
    };

    expect(providerProfileSchema.parse(profile)).toEqual(profile);
    expect(providerProfileSchema.safeParse({ ...profile, apiKey: 'secret' }).success).toBe(false);
    expect(providerProfileSchema.safeParse({ ...profile, model: 'claude-sonnet' }).success).toBe(
      false,
    );
  });

  it('parses enabled unverified models while enforcing default implies enabled', () => {
    const model = {
      id: 'model-1',
      name: 'Operations model',
      providerProfileId: 'provider-1',
      modelId: 'ops-model-v1',
      declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
      contextWindowTokens: 32_768,
      maxOutputTokens: 4_096,
      autoCompact: true,
      compactThresholdPercent: 80,
      supportedReasoningEfforts: ['low', 'xhigh'],
      defaultReasoningEffort: 'xhigh',
      enabled: true,
      isDefault: true,
      validation: {
        status: 'available',
        checkedAt: '2026-07-28T10:00:00.000Z',
        capabilities: { responses: false, streaming: true, toolCalls: true },
        attempt: 1,
      },
      revision: 4,
    };

    expect(modelConfigurationSchema.parse(model)).toEqual(model);
    expect(modelConfigurationSchema.safeParse({ ...model, apiKey: 'secret' }).success).toBe(false);
    expect(
      modelConfigurationSchema.safeParse({
        ...model,
        enabled: true,
        isDefault: false,
        validation: { status: 'unverified' },
      }).success,
    ).toBe(true);
    expect(
      modelConfigurationSchema.safeParse({
        ...model,
        enabled: true,
        isDefault: true,
        validation: {
          status: 'unavailable',
          checkedAt: '2026-07-28T10:01:00.000Z',
          reason: 'connection_failed',
          attempt: 2,
        },
      }).success,
    ).toBe(true);
    expect(
      modelConfigurationSchema.safeParse({ ...model, enabled: false, isDefault: true }).success,
    ).toBe(false);
  });
});
