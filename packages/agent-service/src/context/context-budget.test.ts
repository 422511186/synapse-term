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

    expect(calculateContextBudget(profile)).toEqual({
      inputTokens: 24_800,
      compactAtTokens: 19_840,
      compactTargetTokens: 14_880,
      reservedOutputTokens: 4_000,
      reservedToolTokens: 3_200,
    });
  });
});
