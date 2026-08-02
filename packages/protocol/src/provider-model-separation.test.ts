import { describe, expect, it } from 'vitest';

import * as protocol from './index.js';

describe('provider and model protocol separation', () => {
  it('parses connection-only providers and independent model configurations', () => {
    const api = protocol as typeof protocol & {
      providerProfileSchema: { parse(value: unknown): unknown };
      modelConfigurationSchema: { parse(value: unknown): unknown };
    };
    const provider = {
      id: 'provider-1',
      name: 'Provider 1',
      protocol: 'openai_chat_completions',
      baseUrl: 'https://example.test/v1',
      credentialRef: 'provider:provider-1',
      extraHeaders: {},
      timeoutMs: 30_000,
      revision: 0,
    };
    const model = {
      id: 'model-1',
      name: 'Model 1',
      providerProfileId: 'provider-1',
      modelId: 'model-1',
      declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
      contextWindowTokens: 32_768,
      maxOutputTokens: 4_096,
      autoCompact: true,
      compactThresholdPercent: 80,
      supportedReasoningEfforts: ['low'],
      defaultReasoningEffort: 'low',
      enabled: false,
      isDefault: false,
      validation: { status: 'unverified' },
      revision: 0,
    };

    expect(api.providerProfileSchema.parse(provider)).toEqual(provider);
    expect(api.modelConfigurationSchema.parse(model)).toEqual(model);
    expect(() =>
      api.providerProfileSchema.parse({ ...provider, model: 'should-not-be-here' }),
    ).toThrow();
  });

  it('accepts modelConfigurationId and rejects providerProfileId for new turns', () => {
    expect(
      protocol.parseCoreRequest('agent.start', {
        sessionId: 'session-1',
        goal: '检查服务器',
        modelConfigurationId: 'model-1',
      }),
    ).toMatchObject({
      payload: { modelConfigurationId: 'model-1' },
    });
    expect(() =>
      protocol.parseCoreRequest('agent.start', {
        sessionId: 'session-1',
        goal: '检查服务器',
        providerProfileId: 'provider-1',
      }),
    ).toThrow();
  });
});
