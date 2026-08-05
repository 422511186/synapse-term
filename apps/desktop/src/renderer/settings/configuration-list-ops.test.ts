import { describe, expect, it } from 'vitest';

import type { ModelConfigurationView, ProviderProfileView } from '../../preload/preload-api.js';
import {
  filterModelConfigurations,
  filterProviderProfiles,
  paginateItems,
} from './configuration-list-ops.js';

function provider(overrides: Partial<ProviderProfileView> = {}): ProviderProfileView {
  return {
    id: 'provider-1',
    name: 'OpenAI',
    protocol: 'openai_responses',
    baseUrl: 'https://api.openai.com/v1',
    credentialConfigured: true,
    revision: 1,
    ...overrides,
  };
}

function model(overrides: Partial<ModelConfigurationView> = {}): ModelConfigurationView {
  return {
    id: 'model-1',
    name: 'GPT 5',
    providerProfileId: 'provider-1',
    providerName: 'OpenAI',
    providerProtocol: 'openai_responses',
    modelId: 'gpt-5',
    declaredCapabilities: { responses: true, streaming: true, toolCalls: true },
    contextWindowTokens: 128_000,
    maxOutputTokens: 4_096,
    autoCompact: true,
    compactThresholdPercent: 80,
    supportedReasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
    enabled: true,
    isDefault: false,
    status: 'available',
    validation: {
      status: 'available',
      checkedAt: '2026-01-01T00:00:00.000Z',
      attempt: 1,
      capabilities: { responses: true, streaming: true, toolCalls: true },
    },
    revision: 1,
    ...overrides,
  };
}

describe('configuration list operations', () => {
  it('matches provider search against the name, protocol, and base URL', () => {
    const profiles = [
      provider(),
      provider({ id: 'provider-2', name: 'Local Gateway', baseUrl: 'http://localhost:8080' }),
    ];

    expect(filterProviderProfiles(profiles, 'LOCAL')).toEqual([profiles[1]]);
    expect(filterProviderProfiles(profiles, 'anthropic')).toEqual([]);
    expect(filterProviderProfiles(profiles, 'api.openai.com')).toEqual([profiles[0]]);
  });

  it('combines model search, provider, and status filters', () => {
    const models = [
      model(),
      model({
        id: 'model-2',
        name: 'Fast Local',
        providerProfileId: 'provider-2',
        providerName: 'Local Gateway',
        modelId: 'local-fast',
        enabled: false,
        status: 'unverified',
        validation: { status: 'unverified' },
      }),
    ];

    expect(
      filterModelConfigurations(models, {
        query: 'local-fast',
        providerId: 'provider-2',
        status: 'disabled',
      }),
    ).toEqual([models[1]]);
    expect(
      filterModelConfigurations(models, { query: 'gpt', providerId: 'provider-2', status: 'all' }),
    ).toEqual([]);
  });

  it('returns a bounded page and page count for remote model discovery', () => {
    const values = Array.from({ length: 21 }, (_, index) => `model-${index + 1}`);

    expect(paginateItems(values, 0, 10)).toEqual({
      items: values.slice(0, 10),
      page: 0,
      pageCount: 3,
    });
    expect(paginateItems(values, 4, 10)).toEqual({
      items: ['model-21'],
      page: 2,
      pageCount: 3,
    });
  });
});
