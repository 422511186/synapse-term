import { describe, expect, it } from 'vitest';

import type { ModelConfigurationView } from '../../preload/preload-api.js';
import { formatTestDuration, modelTestOutcome, optimisticSetEnabled } from './model-list-ops.js';

function model(overrides: Partial<ModelConfigurationView>): ModelConfigurationView {
  return {
    id: 'model-1',
    name: 'GPT',
    providerProfileId: 'provider-1',
    providerName: 'OpenAI',
    providerProtocol: 'openai_responses',
    modelId: 'gpt-test',
    contextWindowTokens: 128_000,
    maxOutputTokens: 4_096,
    autoCompact: true,
    compactThresholdPercent: 80,
    declaredCapabilities: { responses: true, streaming: true, toolCalls: true },
    supportedReasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
    enabled: false,
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

describe('optimisticSetEnabled', () => {
  it('flips enabled on the target model and keeps other models unchanged', () => {
    const models = [model({ id: 'a' }), model({ id: 'b', enabled: false })];

    const { next } = optimisticSetEnabled(models, 'a', true);

    expect(next.find((item) => item.id === 'a')?.enabled).toBe(true);
    expect(next.find((item) => item.id === 'b')?.enabled).toBe(false);
    expect(next).toHaveLength(2);
  });

  it('returns the previous model for rollback', () => {
    const models = [model({ id: 'a', enabled: true })];

    const { previous } = optimisticSetEnabled(models, 'a', false);

    expect(previous).toMatchObject({ id: 'a', enabled: true });
  });

  it('returns the original list when the model is missing', () => {
    const models = [model({ id: 'a' })];

    const { next, previous } = optimisticSetEnabled(models, 'missing', true);

    expect(next).toBe(models);
    expect(previous).toBeUndefined();
  });
});

describe('formatTestDuration', () => {
  it('formats milliseconds as a one-decimal seconds string', () => {
    expect(formatTestDuration(1_234)).toBe('1.2s');
  });

  it('keeps sub-second values visible', () => {
    expect(formatTestDuration(350)).toBe('0.4s');
  });
});

describe('modelTestOutcome', () => {
  it('reports success when the validation status is available', () => {
    const result = modelTestOutcome(
      model({
        status: 'available',
        validation: {
          status: 'available',
          checkedAt: '2026-01-01T00:00:00.000Z',
          attempt: 1,
          capabilities: { responses: true, streaming: true, toolCalls: true },
        },
      }),
    );

    expect(result).toEqual({ ok: true, message: '' });
  });

  it('reports the validation reason when the model is unavailable', () => {
    const result = modelTestOutcome(
      model({
        status: 'unavailable',
        validation: {
          status: 'unavailable',
          checkedAt: '2026-01-01T00:00:00.000Z',
          attempt: 1,
          reason: 'model_not_found: 模型不存在',
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('模型不存在');
  });

  it('falls back to a generic message for unverified validation', () => {
    const result = modelTestOutcome(
      model({ status: 'unverified', validation: { status: 'unverified' } }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('不可用');
  });
});
