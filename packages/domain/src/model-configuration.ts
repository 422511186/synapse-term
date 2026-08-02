export const MODEL_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;
export type ModelReasoningEffort = (typeof MODEL_REASONING_EFFORTS)[number];

export interface ModelCapabilities {
  responses: boolean;
  streaming: boolean;
  toolCalls: boolean;
  reasoning?: boolean | undefined;
}

export interface CreateModelConfigurationInput {
  id: string;
  name: string;
  providerProfileId: string;
  modelId: string;
  declaredCapabilities: ModelCapabilities;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  autoCompact?: boolean;
  compactThresholdPercent?: number;
  supportedReasoningEfforts?: readonly ModelReasoningEffort[];
  defaultReasoningEffort?: ModelReasoningEffort;
}

export type ModelValidation =
  | { status: 'unverified' }
  | { status: 'validating'; attempt: number }
  | {
      status: 'available';
      checkedAt: string;
      capabilities: ModelCapabilities;
      attempt: number;
    }
  | { status: 'unavailable'; checkedAt: string; reason: string; attempt: number };

export type ModelValidationOutcome =
  | { status: 'available'; checkedAt: string; capabilities: ModelCapabilities }
  | { status: 'unavailable'; checkedAt: string; reason: string };

export interface ModelConfiguration extends CreateModelConfigurationInput {
  contextWindowTokens: number;
  maxOutputTokens: number;
  autoCompact: boolean;
  compactThresholdPercent: number;
  supportedReasoningEfforts: readonly ModelReasoningEffort[];
  defaultReasoningEffort: ModelReasoningEffort;
  enabled: boolean;
  isDefault: boolean;
  validation: ModelValidation;
  revision: number;
}

export interface AgentModelSelection {
  readonly modelConfigurationId: string;
  readonly modelConfigurationRevision: number;
  readonly modelConfigurationName: string;
  readonly modelId: string;
  readonly providerProfileId: string;
  readonly providerProfileRevision: number;
  readonly providerProfileName: string;
  readonly protocol: ProviderProtocol;
  readonly capabilities: ModelCapabilities;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly autoCompact: boolean;
  readonly compactThresholdPercent: number;
  readonly supportedReasoningEfforts: readonly ModelReasoningEffort[];
  readonly defaultReasoningEffort: ModelReasoningEffort;
}

export type ModelConfigurationTransitionResult =
  | { ok: true; value: ModelConfiguration }
  | {
      ok: false;
      error: 'invalid-model-validation-transition' | 'model-not-available';
    };

export function createModelConfiguration(input: CreateModelConfigurationInput): ModelConfiguration {
  const contextWindowTokens = input.contextWindowTokens ?? 128_000;
  const maxOutputTokens = input.maxOutputTokens ?? 8_192;
  const compactThresholdPercent = input.compactThresholdPercent ?? 80;
  const supportedReasoningEfforts = [...(input.supportedReasoningEfforts ?? ['low'])];
  const defaultReasoningEffort = input.defaultReasoningEffort ?? supportedReasoningEfforts[0];
  if (contextWindowTokens <= maxOutputTokens || maxOutputTokens < 1) {
    throw new RangeError('context window must exceed max output tokens');
  }
  if (compactThresholdPercent < 50 || compactThresholdPercent > 95) {
    throw new RangeError('compact threshold percent must be between 50 and 95');
  }
  if (
    supportedReasoningEfforts.length === 0 ||
    supportedReasoningEfforts.some(
      (effort) => !MODEL_REASONING_EFFORTS.includes(effort as ModelReasoningEffort),
    ) ||
    new Set(supportedReasoningEfforts).size !== supportedReasoningEfforts.length ||
    defaultReasoningEffort === undefined ||
    !supportedReasoningEfforts.includes(defaultReasoningEffort)
  ) {
    throw new RangeError('default reasoning effort must be supported');
  }
  return {
    ...input,
    declaredCapabilities: { ...input.declaredCapabilities },
    contextWindowTokens,
    maxOutputTokens,
    autoCompact: input.autoCompact ?? true,
    compactThresholdPercent,
    supportedReasoningEfforts,
    defaultReasoningEffort,
    enabled: false,
    isDefault: false,
    validation: { status: 'unverified' },
    revision: 0,
  };
}

export function createAgentModelSelection(
  provider: ProviderProfile,
  model: ModelConfiguration,
): AgentModelSelection {
  if (model.providerProfileId !== provider.id) {
    throw new Error('model configuration references another provider profile');
  }
  if (!model.enabled) {
    throw new Error('model configuration is not eligible');
  }
  const capabilities =
    model.validation.status === 'available'
      ? model.validation.capabilities
      : model.declaredCapabilities;
  return Object.freeze({
    modelConfigurationId: model.id,
    modelConfigurationRevision: model.revision,
    modelConfigurationName: model.name,
    modelId: model.modelId,
    providerProfileId: provider.id,
    providerProfileRevision: provider.revision,
    providerProfileName: provider.name,
    protocol: provider.protocol,
    capabilities: Object.freeze({ ...capabilities }),
    contextWindowTokens: model.contextWindowTokens,
    maxOutputTokens: model.maxOutputTokens,
    autoCompact: model.autoCompact,
    compactThresholdPercent: model.compactThresholdPercent,
    supportedReasoningEfforts: Object.freeze([...model.supportedReasoningEfforts]),
    defaultReasoningEffort: model.defaultReasoningEffort,
  });
}

export function beginModelValidation(
  model: ModelConfiguration,
): ModelConfigurationTransitionResult {
  if (model.validation.status === 'validating') {
    return { ok: false, error: 'invalid-model-validation-transition' };
  }
  const previousAttempt = model.validation.status === 'unverified' ? 0 : model.validation.attempt;
  return {
    ok: true,
    value: {
      ...model,
      validation: { status: 'validating', attempt: previousAttempt + 1 },
      revision: model.revision + 1,
    },
  };
}

export function finishModelValidation(
  model: ModelConfiguration,
  outcome: ModelValidationOutcome,
): ModelConfigurationTransitionResult {
  if (model.validation.status !== 'validating') {
    return { ok: false, error: 'invalid-model-validation-transition' };
  }
  return {
    ok: true,
    value: {
      ...model,
      validation: { ...outcome, attempt: model.validation.attempt },
      revision: model.revision + 1,
    },
  };
}

export function setModelConfigurationEnabled(
  model: ModelConfiguration,
  enabled: boolean,
): ModelConfigurationTransitionResult {
  return {
    ok: true,
    value: {
      ...model,
      enabled,
      isDefault: enabled ? model.isDefault : false,
      revision: model.revision + 1,
    },
  };
}

export function setModelConfigurationDefault(
  model: ModelConfiguration,
  isDefault: boolean,
): ModelConfigurationTransitionResult {
  if (isDefault && !model.enabled) {
    return { ok: false, error: 'model-not-available' };
  }
  return {
    ok: true,
    value: { ...model, isDefault, revision: model.revision + 1 },
  };
}

export type ModelConfigurationUpdate = Partial<
  Pick<
    CreateModelConfigurationInput,
    | 'name'
    | 'modelId'
    | 'declaredCapabilities'
    | 'contextWindowTokens'
    | 'maxOutputTokens'
    | 'autoCompact'
    | 'compactThresholdPercent'
    | 'supportedReasoningEfforts'
    | 'defaultReasoningEffort'
  >
>;

export function updateModelConfiguration(
  model: ModelConfiguration,
  update: ModelConfigurationUpdate,
): ModelConfiguration {
  const next = createModelConfiguration({
    ...model,
    ...update,
    declaredCapabilities: update.declaredCapabilities ?? model.declaredCapabilities,
  });
  const requiresRevalidation =
    (update.modelId !== undefined && update.modelId !== model.modelId) ||
    (update.declaredCapabilities !== undefined &&
      JSON.stringify(update.declaredCapabilities) !== JSON.stringify(model.declaredCapabilities));
  return {
    ...next,
    validation: requiresRevalidation ? { status: 'unverified' } : model.validation,
    enabled: model.enabled,
    isDefault: model.isDefault,
    revision: model.revision + 1,
  };
}

export function resetModelValidation(model: ModelConfiguration): ModelConfiguration {
  return {
    ...model,
    validation: { status: 'unverified' },
    revision: model.revision + 1,
  };
}
import type { ProviderProfile, ProviderProtocol } from './provider-profile.js';
