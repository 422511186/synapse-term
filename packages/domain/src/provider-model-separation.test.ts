import { describe, expect, it } from 'vitest';

import * as domain from './index.js';

describe('provider and model separation', () => {
  it('keeps provider connections independent from model configurations', () => {
    const api = domain as typeof domain & {
      createProviderProfile(input: Record<string, unknown>): Record<string, unknown>;
      createModelConfiguration(input: Record<string, unknown>): Record<string, unknown>;
    };

    expect(
      api.createProviderProfile({
        id: 'provider-local',
        name: '本机兼容服务',
        protocol: 'openai_chat_completions',
        baseUrl: 'http://127.0.0.1:5090/v1',
        credentialRef: 'provider:provider-local',
        extraHeaders: {},
        timeoutMs: 30_000,
      }),
    ).toEqual({
      id: 'provider-local',
      name: '本机兼容服务',
      protocol: 'openai_chat_completions',
      baseUrl: 'http://127.0.0.1:5090/v1',
      credentialRef: 'provider:provider-local',
      extraHeaders: {},
      timeoutMs: 30_000,
      revision: 0,
    });

    expect(
      api.createModelConfiguration({
        id: 'model-mimo',
        name: 'Mimo v2.5 Pro',
        providerProfileId: 'provider-local',
        modelId: 'mimo-v2.5-pro',
        declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
        maxOutputTokens: 4_096,
      }),
    ).toMatchObject({
      providerProfileId: 'provider-local',
      modelId: 'mimo-v2.5-pro',
      enabled: false,
      isDefault: false,
      validation: { status: 'unverified' },
    });
  });

  it('stores an immutable model and provider snapshot on each turn', () => {
    const turn = domain.createAgentTurn({
      id: 'turn-1',
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      modelConfigurationId: 'model-mimo',
      modelConfigurationRevision: 3,
      modelConfigurationName: 'Mimo v2.5 Pro',
      providerProfileId: 'provider-local',
      providerProfileRevision: 2,
      providerProfileName: '本机兼容服务',
      protocol: 'openai_chat_completions',
      modelId: 'mimo-v2.5-pro',
      capabilities: { responses: false, streaming: true, toolCalls: true },
      contextWindowTokens: 128_000,
      maxOutputTokens: 4_096,
      autoCompact: true,
      compactThresholdPercent: 80,
      supportedReasoningEfforts: ['low'],
      defaultReasoningEffort: 'low',
      reasoningEffort: 'low',
      permissionMode: 'manual',
      userMessage: '检查服务器状态',
    } as never);

    expect(turn).toMatchObject({
      modelConfigurationId: 'model-mimo',
      modelConfigurationRevision: 3,
      modelConfigurationName: 'Mimo v2.5 Pro',
      providerProfileId: 'provider-local',
      providerProfileRevision: 2,
      providerProfileName: '本机兼容服务',
      modelId: 'mimo-v2.5-pro',
      capabilities: { responses: false, streaming: true, toolCalls: true },
    });
    expect(turn).not.toHaveProperty('model');
  });
});
