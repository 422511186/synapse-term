import { describe, expect, it } from 'vitest';

import * as domain from './index.js';

describe('model configuration', () => {
  it('is exposed as an independent domain factory', () => {
    expect(domain).toMatchObject({
      createModelConfiguration: expect.any(Function),
      createAgentModelSelection: expect.any(Function),
      beginModelValidation: expect.any(Function),
      finishModelValidation: expect.any(Function),
      setModelConfigurationEnabled: expect.any(Function),
      setModelConfigurationDefault: expect.any(Function),
    });
  });

  it('starts as a disabled and unverified model under one provider', () => {
    const createModelConfiguration = (
      domain as typeof domain & {
        createModelConfiguration(input: Record<string, unknown>): Record<string, unknown>;
      }
    ).createModelConfiguration;

    expect(
      createModelConfiguration({
        id: 'model-gpt-5',
        name: 'GPT-5',
        providerProfileId: 'provider-openai',
        modelId: 'gpt-5',
        declaredCapabilities: { responses: true, streaming: true, toolCalls: true },
      }),
    ).toEqual({
      id: 'model-gpt-5',
      name: 'GPT-5',
      providerProfileId: 'provider-openai',
      modelId: 'gpt-5',
      declaredCapabilities: { responses: true, streaming: true, toolCalls: true },
      contextWindowTokens: 128_000,
      maxOutputTokens: 8_192,
      autoCompact: true,
      compactThresholdPercent: 80,
      supportedReasoningEfforts: ['low'],
      defaultReasoningEffort: 'low',
      enabled: false,
      isDefault: false,
      validation: { status: 'unverified' },
      revision: 0,
    });
  });

  it('keeps enable and default independent from optional validation', () => {
    const api = domain as typeof domain & {
      beginModelValidation(value: Record<string, unknown>): Record<string, unknown>;
      finishModelValidation(
        value: Record<string, unknown>,
        outcome: Record<string, unknown>,
      ): Record<string, unknown>;
      setModelConfigurationEnabled(
        value: Record<string, unknown>,
        enabled: boolean,
      ): Record<string, unknown>;
      setModelConfigurationDefault(
        value: Record<string, unknown>,
        isDefault: boolean,
      ): Record<string, unknown>;
      updateModelConfiguration(
        value: Record<string, unknown>,
        update: Record<string, unknown>,
      ): Record<string, unknown>;
    };
    const model = api.createModelConfiguration({
      id: 'model-1',
      name: 'Model 1',
      providerProfileId: 'provider-1',
      modelId: 'model-1',
      declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
    });

    const enabledBeforeValidation = api.setModelConfigurationEnabled(model, true) as unknown as {
      ok: true;
      value: Record<string, unknown>;
    };
    expect(enabledBeforeValidation).toMatchObject({
      ok: true,
      value: { enabled: true, isDefault: false, validation: { status: 'unverified' }, revision: 1 },
    });
    const defaultBeforeValidation = api.setModelConfigurationDefault(
      enabledBeforeValidation.value,
      true,
    ) as unknown as { ok: true; value: Record<string, unknown> };
    expect(defaultBeforeValidation).toMatchObject({
      ok: true,
      value: { enabled: true, isDefault: true, validation: { status: 'unverified' }, revision: 2 },
    });

    const validating = api.beginModelValidation(defaultBeforeValidation.value) as unknown as {
      ok: true;
      value: Record<string, unknown>;
    };
    const available = api.finishModelValidation(validating.value, {
      status: 'available',
      checkedAt: '2026-07-28T10:00:00.000Z',
      capabilities: { responses: false, streaming: true, toolCalls: true },
    }) as unknown as { ok: true; value: Record<string, unknown> };
    expect(available.value).toMatchObject({
      enabled: true,
      isDefault: true,
      validation: { status: 'available', attempt: 1 },
    });

    const renamed = api.updateModelConfiguration(available.value, { name: 'Model 1 renamed' });
    expect(renamed).toMatchObject({
      name: 'Model 1 renamed',
      enabled: true,
      isDefault: true,
      validation: { status: 'available', attempt: 1 },
    });

    const rewired = api.updateModelConfiguration(available.value, { modelId: 'model-2' });
    expect(rewired).toMatchObject({
      modelId: 'model-2',
      enabled: true,
      isDefault: true,
      validation: { status: 'unverified' },
    });

    const revalidating = api.beginModelValidation(rewired) as unknown as {
      ok: true;
      value: Record<string, unknown>;
    };
    const unavailable = api.finishModelValidation(revalidating.value, {
      status: 'unavailable',
      checkedAt: '2026-07-28T11:00:00.000Z',
      reason: 'connection_failed',
    });
    expect(unavailable).toMatchObject({
      ok: true,
      value: { enabled: true, isDefault: true, validation: { status: 'unavailable' } },
    });
  });

  it('rejects inconsistent context and reasoning settings', () => {
    expect(() =>
      domain.createModelConfiguration({
        id: 'model-invalid-window',
        name: 'Invalid window',
        providerProfileId: 'provider-1',
        modelId: 'model-invalid-window',
        declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
        contextWindowTokens: 4_096,
        maxOutputTokens: 4_096,
      }),
    ).toThrow(/context window/i);

    expect(() =>
      domain.createModelConfiguration({
        id: 'model-invalid-reasoning',
        name: 'Invalid reasoning',
        providerProfileId: 'provider-1',
        modelId: 'model-invalid-reasoning',
        declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
        supportedReasoningEfforts: ['low'],
        defaultReasoningEffort: 'high',
      }),
    ).toThrow(/reasoning effort/i);

    expect(() =>
      domain.createModelConfiguration({
        id: 'model-legacy-reasoning',
        name: 'Legacy reasoning',
        providerProfileId: 'provider-1',
        modelId: 'model-legacy-reasoning',
        declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
        supportedReasoningEfforts: ['minimal'] as never,
        defaultReasoningEffort: 'minimal' as never,
      }),
    ).toThrow(/reasoning effort/i);

    expect(
      domain.createModelConfiguration({
        id: 'model-xhigh',
        name: 'Extra high reasoning',
        providerProfileId: 'provider-1',
        modelId: 'model-xhigh',
        declaredCapabilities: {
          responses: true,
          streaming: true,
          toolCalls: true,
          reasoning: true,
        },
        supportedReasoningEfforts: ['low', 'xhigh'] as never,
        defaultReasoningEffort: 'xhigh' as never,
      }),
    ).toMatchObject({
      supportedReasoningEfforts: ['low', 'xhigh'],
      defaultReasoningEffort: 'xhigh',
    });
  });

  it('creates an immutable provider and model snapshot for a turn', () => {
    const api = domain as typeof domain & {
      createAgentModelSelection(
        provider: Record<string, unknown>,
        model: Record<string, unknown>,
      ): Record<string, unknown>;
    };
    const headers = { 'X-Tenant': 'ops' };
    const capabilities = { responses: false, streaming: true, toolCalls: true };
    const provider = domain.createProviderProfile({
      id: 'provider-1',
      name: 'Shared provider',
      protocol: 'openai_chat_completions',
      baseUrl: 'https://llm.example.test/v1',
      credentialRef: 'credential:provider-1',
      extraHeaders: headers,
      timeoutMs: 30_000,
    } as Parameters<typeof domain.createProviderProfile>[0]);
    const model = domain.createModelConfiguration({
      id: 'model-1',
      name: 'Operations model',
      providerProfileId: provider.id,
      modelId: 'ops-model-v1',
      declaredCapabilities: capabilities,
    });
    const enabled = domain.setModelConfigurationEnabled(model, true);
    if (!enabled.ok) throw new Error('expected model to enable');

    const selection = api.createAgentModelSelection(provider, enabled.value);
    headers['X-Tenant'] = 'changed';
    capabilities.toolCalls = false;
    model.name = 'Changed later';

    expect(selection).toMatchObject({
      modelConfigurationId: 'model-1',
      modelConfigurationRevision: 1,
      modelConfigurationName: 'Operations model',
      modelId: 'ops-model-v1',
      providerProfileId: 'provider-1',
      providerProfileRevision: 0,
      providerProfileName: 'Shared provider',
      protocol: 'openai_chat_completions',
      capabilities: { responses: false, streaming: true, toolCalls: true },
    });
    expect(selection).not.toHaveProperty('credentialRef');
  });
});
