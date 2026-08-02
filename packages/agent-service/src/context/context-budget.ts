export interface ContextBudget {
  inputTokens: number;
  compactAtTokens: number;
  compactTargetTokens: number;
  reservedOutputTokens: number;
  reservedToolTokens: number;
}

export interface ContextWindowConfig {
  contextWindowTokens: number;
  maxOutputTokens: number;
  compactThresholdPercent: number;
}

export function calculateContextBudget(profile: ContextWindowConfig): ContextBudget {
  const reservedOutputTokens = profile.maxOutputTokens;
  const reservedToolTokens = Math.min(4_096, Math.floor(profile.contextWindowTokens * 0.1));
  const inputTokens = profile.contextWindowTokens - reservedOutputTokens - reservedToolTokens;
  if (inputTokens < 128) throw new RangeError('Model context window leaves no usable input budget');
  return {
    inputTokens,
    compactAtTokens: Math.floor((inputTokens * profile.compactThresholdPercent) / 100),
    compactTargetTokens: Math.floor(inputTokens * 0.6),
    reservedOutputTokens,
    reservedToolTokens,
  };
}
