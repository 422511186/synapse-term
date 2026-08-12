import { describe, expect, it } from 'vitest';

import { createModelConfiguration } from '@synapse-term/domain';

import { calculateContextBudget } from './context-budget.js';

describe('calculateContextBudget', () => {
  it('reserves output and tool headroom before applying the compaction threshold', () => {
    const profile = createModelConfiguration({
      id: 'model-configuration-1',
      name: 'Small context',
      providerProfileId: 'provider-1',
      modelId: 'model-1',
      declaredCapabilities: { responses: true, streaming: true, toolCalls: true },
      contextWindowTokens: 32_000,
      maxOutputTokens: 4_000,
      compactThresholdPercent: 80,
    });

    const budget = calculateContextBudget(profile);
    // 单阈值（向后兼容）与三闸门阈值同时产出。
    expect(budget).toEqual({
      inputTokens: 24_800,
      compactAtTokens: 19_840,
      compactTargetTokens: 14_880,
      reservedOutputTokens: 4_000,
      reservedToolTokens: 3_200,
      proactiveTokens: 22_320,
      preflightTokens: 23_560,
      reactiveOnOverflow: true,
    });
  });

  it('derives proactive at 0.90 and preflight at 0.95 of the input budget', () => {
    const profile = createModelConfiguration({
      id: 'model-configuration-2',
      name: 'Thresholds',
      providerProfileId: 'provider-1',
      modelId: 'model-1',
      declaredCapabilities: { responses: true, streaming: true, toolCalls: true },
      contextWindowTokens: 10_000,
      maxOutputTokens: 1_000,
      compactThresholdPercent: 80,
    });
    const budget = calculateContextBudget(profile);
    // inputTokens = 10000 − 1000 − min(4096, 1000) = 8000
    expect(budget.inputTokens).toBe(8_000);
    expect(budget.proactiveTokens).toBe(Math.floor(8_000 * 0.9));
    expect(budget.preflightTokens).toBe(Math.floor(8_000 * 0.95));
    expect(budget.reactiveOnOverflow).toBe(true);
  });
});
