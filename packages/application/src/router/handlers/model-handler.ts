/**
 * Model 请求处理
 *
 * model.* 用例：模型配置增删改查、校验、启用/默认切换与发现结果导入。
 * 视图统一携带 Provider 快照信息，validation 状态原样返回。
 */
import type { ModelConfiguration, ProviderProfile } from '@synapse-term/domain';
import type { AuditRecordInput } from '@synapse-term/infrastructure';
import type {
  ModelCatalogService,
  ModelValidator,
  ProviderProfileService,
} from '@synapse-term/model-providers';

import { routerError } from '../contracts.js';
import type { AuditQueryLike, CoreSecretStore, ProviderAdapterFactory } from '../contracts.js';

export interface ModelRequestHandlerOptions {
  models?: ModelCatalogService | undefined;
  providers?: ProviderProfileService | undefined;
  secrets?: CoreSecretStore | undefined;
  modelValidator?: ModelValidator | undefined;
  createAdapter?: ProviderAdapterFactory | undefined;
  audit?: AuditQueryLike | undefined;
}

export class ModelRequestHandler {
  readonly #models: ModelCatalogService | undefined;
  readonly #providers: ProviderProfileService | undefined;
  readonly #secrets: CoreSecretStore | undefined;
  readonly #modelValidator: ModelValidator | undefined;
  readonly #createAdapter: ProviderAdapterFactory | undefined;
  readonly #audit: AuditQueryLike | undefined;

  constructor(options: ModelRequestHandlerOptions) {
    this.#models = options.models;
    this.#providers = options.providers;
    this.#secrets = options.secrets;
    this.#modelValidator = options.modelValidator;
    this.#createAdapter = options.createAdapter;
    this.#audit = options.audit;
  }

  listModels(): unknown[] {
    return this.#requireModels()
      .list()
      .map((model) => this.#modelView(model));
  }

  saveModel(input: {
    id: string;
    name: string;
    providerProfileId: string;
    modelId: string;
    contextWindowTokens: number;
    maxOutputTokens: number;
    autoCompact: boolean;
    compactThresholdPercent: number;
    supportedReasoningEfforts: ModelConfiguration['supportedReasoningEfforts'];
    defaultReasoningEffort: ModelConfiguration['defaultReasoningEffort'];
    declaredCapabilities: ModelConfiguration['declaredCapabilities'];
  }): null {
    this.#requireProvider(input.providerProfileId);
    const models = this.#requireModels();
    const current = models.get(input.id);
    if (current === undefined) {
      models.create(input);
    } else {
      if (current.providerProfileId !== input.providerProfileId) {
        throw routerError('invalid_message', 'Model Configuration provider cannot be changed');
      }
      models.update(input.id, {
        name: input.name,
        modelId: input.modelId,
        contextWindowTokens: input.contextWindowTokens,
        maxOutputTokens: input.maxOutputTokens,
        autoCompact: input.autoCompact,
        compactThresholdPercent: input.compactThresholdPercent,
        supportedReasoningEfforts: input.supportedReasoningEfforts,
        defaultReasoningEffort: input.defaultReasoningEffort,
        declaredCapabilities: input.declaredCapabilities,
      });
    }
    this.#recordAudit({
      actor: { kind: 'user' },
      type: current === undefined ? 'model.created' : 'model.updated',
      payload: { modelConfigurationId: input.id, providerProfileId: input.providerProfileId },
    });
    return null;
  }

  async testModel(modelConfigurationId: string): Promise<unknown> {
    const models = this.#requireModels();
    const model = models.get(modelConfigurationId);
    if (model === undefined)
      throw routerError('provider_unavailable', 'Model Configuration not found');
    const profile = this.#requireProvider(model.providerProfileId);
    const secret = await this.#requireSecrets().get(profile.credentialRef);
    if (secret === undefined)
      throw routerError('provider_unavailable', 'Provider credential is missing');
    const validator = this.#modelValidator;
    const createAdapter = this.#createAdapter;
    if (validator === undefined || createAdapter === undefined) {
      throw routerError('provider_unavailable', 'Model validation is not configured');
    }
    const validated = await validator.validate(
      model,
      profile,
      createAdapter(profile, model, secret),
    );
    models.save(validated);
    this.#recordAudit({
      actor: { kind: 'user' },
      type: 'model.tested',
      payload: {
        modelConfigurationId,
        providerProfileId: profile.id,
        status: validated.validation.status,
        ...(validated.validation.status === 'unavailable'
          ? { reason: validated.validation.reason }
          : {}),
      },
    });
    return this.#modelView(validated);
  }

  setModelEnabled(modelConfigurationId: string, enabled: boolean): unknown {
    return this.#modelView(this.#requireModels().setEnabled(modelConfigurationId, enabled));
  }

  setDefaultModel(modelConfigurationId: string, isDefault: boolean): unknown {
    return this.#modelView(this.#requireModels().setDefault(modelConfigurationId, isDefault));
  }

  removeModel(modelConfigurationId: string): boolean {
    const removed = this.#requireModels().delete(modelConfigurationId);
    if (removed) {
      this.#recordAudit({
        actor: { kind: 'user' },
        type: 'model.removed',
        payload: { modelConfigurationId },
      });
    }
    return removed;
  }

  importDiscoveredModels(providerProfileId: string, modelIds: readonly string[]): unknown {
    this.#requireProvider(providerProfileId);
    return this.#requireModels().importDiscovered(providerProfileId, modelIds);
  }

  #modelView(model: ModelConfiguration): Record<string, unknown> {
    const provider = this.#requireProvider(model.providerProfileId);
    return {
      id: model.id,
      name: model.name,
      providerProfileId: model.providerProfileId,
      providerName: provider.name,
      providerProtocol: provider.protocol,
      modelId: model.modelId,
      contextWindowTokens: model.contextWindowTokens,
      maxOutputTokens: model.maxOutputTokens,
      autoCompact: model.autoCompact,
      compactThresholdPercent: model.compactThresholdPercent,
      supportedReasoningEfforts: model.supportedReasoningEfforts,
      defaultReasoningEffort: model.defaultReasoningEffort,
      declaredCapabilities: model.declaredCapabilities,
      enabled: model.enabled,
      isDefault: model.isDefault,
      status: model.validation.status,
      validation: model.validation,
      revision: model.revision,
    };
  }

  #requireModels(): ModelCatalogService {
    if (this.#models === undefined) {
      throw routerError('provider_unavailable', 'Model catalog is not configured');
    }
    return this.#models;
  }

  #requireProvider(id: string): ProviderProfile {
    if (this.#providers === undefined)
      throw routerError('provider_unavailable', 'Provider service is not configured');
    const provider = this.#providers.get(id);
    if (provider === undefined) {
      throw routerError('provider_unavailable', `Provider Profile ${id} not found`);
    }
    return provider;
  }

  #requireSecrets(): CoreSecretStore {
    if (this.#secrets === undefined)
      throw routerError('secret_store_error', 'SecretStore is not configured');
    return this.#secrets;
  }

  #recordAudit(input: AuditRecordInput): void {
    this.#audit?.record?.(input);
  }
}
