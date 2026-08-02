import { randomUUID } from 'node:crypto';

import {
  createModelConfiguration,
  resetModelValidation,
  setModelConfigurationDefault,
  setModelConfigurationEnabled,
  updateModelConfiguration,
  type CreateModelConfigurationInput,
  type ModelConfiguration,
  type ModelConfigurationUpdate,
} from '@terminal-agent/domain';

export interface ModelCatalogRepository {
  saveModelConfiguration(model: ModelConfiguration): void;
  getModelConfiguration(id: string): ModelConfiguration | undefined;
  listModelConfigurations(): ModelConfiguration[];
  deleteModelConfiguration(id: string): boolean;
}

export class ModelCatalogError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'ModelCatalogError';
  }
}

export class ModelCatalogService {
  readonly #repository: ModelCatalogRepository;
  readonly #createId: (modelId: string, providerProfileId: string) => string;

  constructor(
    repository: ModelCatalogRepository,
    options: { createId?: (modelId: string, providerProfileId: string) => string } = {},
  ) {
    this.#repository = repository;
    this.#createId = options.createId ?? (() => randomUUID());
  }

  create(input: CreateModelConfigurationInput): ModelConfiguration {
    if (
      this.get(input.id) !== undefined ||
      this.#findByProviderAndModel(input.providerProfileId, input.modelId)
    ) {
      throw new ModelCatalogError(
        'model_configuration_exists',
        '同一 Provider 下已存在该模型配置。',
      );
    }
    const model = createModelConfiguration(input);
    this.#repository.saveModelConfiguration(model);
    return model;
  }

  get(id: string): ModelConfiguration | undefined {
    return this.#repository.getModelConfiguration(id);
  }

  list(): ModelConfiguration[] {
    return this.#repository
      .listModelConfigurations()
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name, 'zh-CN') ||
          left.modelId.localeCompare(right.modelId, 'en-US') ||
          left.id.localeCompare(right.id, 'en-US'),
      );
  }

  listEligible(): ModelConfiguration[] {
    return this.list().filter((model) => model.enabled);
  }

  listByProvider(providerProfileId: string): ModelConfiguration[] {
    return this.list().filter((model) => model.providerProfileId === providerProfileId);
  }

  update(id: string, update: ModelConfigurationUpdate): ModelConfiguration {
    const current = this.#require(id);
    const nextModelId = update.modelId ?? current.modelId;
    const duplicate = this.#findByProviderAndModel(current.providerProfileId, nextModelId);
    if (duplicate !== undefined && duplicate.id !== id) {
      throw new ModelCatalogError(
        'model_configuration_exists',
        '同一 Provider 下已存在该模型配置。',
      );
    }
    const updated = updateModelConfiguration(current, update);
    this.#repository.saveModelConfiguration(updated);
    return updated;
  }

  save(model: ModelConfiguration): ModelConfiguration {
    this.#repository.saveModelConfiguration(model);
    return model;
  }

  setEnabled(id: string, enabled: boolean): ModelConfiguration {
    const result = setModelConfigurationEnabled(this.#require(id), enabled);
    if (!result.ok) throw new ModelCatalogError(result.error, '模型启用状态无效。');
    this.#repository.saveModelConfiguration(result.value);
    return result.value;
  }

  setDefault(id: string, isDefault: boolean): ModelConfiguration {
    const current = this.#require(id);
    const result = setModelConfigurationDefault(current, isDefault);
    if (!result.ok) throw new ModelCatalogError(result.error, '默认模型必须已启用。');
    if (isDefault) {
      for (const model of this.list()) {
        if (model.id === id || !model.isDefault) continue;
        const cleared = setModelConfigurationDefault(model, false);
        if (cleared.ok) this.#repository.saveModelConfiguration(cleared.value);
      }
    }
    this.#repository.saveModelConfiguration(result.value);
    return result.value;
  }

  invalidateProvider(providerProfileId: string): number {
    const models = this.listByProvider(providerProfileId);
    for (const model of models)
      this.#repository.saveModelConfiguration(resetModelValidation(model));
    return models.length;
  }

  delete(id: string): boolean {
    return this.#repository.deleteModelConfiguration(id);
  }

  importDiscovered(
    providerProfileId: string,
    modelIds: readonly string[],
  ): { created: string[]; skipped: string[] } {
    const created: string[] = [];
    const skipped: string[] = [];
    for (const modelId of [...modelIds]
      .map((value) => value.trim())
      .filter(Boolean)
      .sort()) {
      if (this.#findByProviderAndModel(providerProfileId, modelId) !== undefined) {
        skipped.push(modelId);
        continue;
      }
      const model = this.create({
        id: this.#createId(modelId, providerProfileId),
        name: modelId,
        providerProfileId,
        modelId,
        declaredCapabilities: { responses: false, streaming: false, toolCalls: false },
      });
      created.push(model.id);
    }
    return { created, skipped };
  }

  #require(id: string): ModelConfiguration {
    const model = this.get(id);
    if (model === undefined) {
      throw new ModelCatalogError('model_configuration_not_found', '模型配置不存在。');
    }
    return model;
  }

  #findByProviderAndModel(
    providerProfileId: string,
    modelId: string,
  ): ModelConfiguration | undefined {
    return this.#repository
      .listModelConfigurations()
      .find((model) => model.providerProfileId === providerProfileId && model.modelId === modelId);
  }
}
