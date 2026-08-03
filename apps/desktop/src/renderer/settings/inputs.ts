/** 模型/Provider 草稿输入构造（自 app.tsx 拆分） */
import type {
  ModelConfigurationInput,
  ModelConfigurationView,
  ProviderProfileInput,
  ProviderProfileView,
  ReasoningEffort,
} from '../../preload/preload-api.js';

export function newModelInput(providerProfileId: string): ModelConfigurationInput {
  const supportedReasoningEfforts: ReasoningEffort[] = ['low', 'medium', 'high'];
  return {
    id: `model-${crypto.randomUUID()}`,
    name: '',
    providerProfileId,
    modelId: '',
    declaredCapabilities: {
      responses: true,
      streaming: true,
      toolCalls: true,
      multimodal: false,
    },
    contextWindowTokens: 128_000,
    maxOutputTokens: 4_096,
    autoCompact: true,
    compactThresholdPercent: 80,
    supportedReasoningEfforts,
    defaultReasoningEffort: 'medium',
  };
}
export function modelInput(model: ModelConfigurationView): ModelConfigurationInput {
  return {
    id: model.id,
    name: model.name,
    providerProfileId: model.providerProfileId,
    modelId: model.modelId,
    declaredCapabilities: {
      ...model.declaredCapabilities,
      multimodal: model.declaredCapabilities.multimodal === true,
    },
    contextWindowTokens: model.contextWindowTokens,
    maxOutputTokens: model.maxOutputTokens,
    autoCompact: model.autoCompact,
    compactThresholdPercent: model.compactThresholdPercent,
    supportedReasoningEfforts: model.supportedReasoningEfforts,
    defaultReasoningEffort: model.defaultReasoningEffort,
  };
}
export function newProviderInput(): ProviderProfileInput {
  return {
    id: `provider-${crypto.randomUUID()}`,
    name: '',
    protocol: 'openai_responses',
    baseUrl: 'https://api.openai.com/v1',
    extraHeaders: {},
    timeoutMs: 30_000,
  };
}
export function providerInput(provider: ProviderProfileView): ProviderProfileInput {
  return {
    id: provider.id,
    name: provider.name,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    ...(provider.extraHeaders === undefined ? {} : { extraHeaders: provider.extraHeaders }),
    ...(provider.timeoutMs === undefined ? {} : { timeoutMs: provider.timeoutMs }),
  };
}
