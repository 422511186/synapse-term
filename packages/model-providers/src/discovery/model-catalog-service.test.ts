import { describe, expect, it } from 'vitest';

import {
  finishModelValidation,
  beginModelValidation,
  type ModelConfiguration,
} from '@synapse-term/domain';

import { ModelCatalogService } from './model-catalog-service.js';

class MemoryModelRepository {
  readonly values = new Map<string, ModelConfiguration>();

  saveModelConfiguration(model: ModelConfiguration): void {
    this.values.set(model.id, structuredClone(model));
  }

  getModelConfiguration(id: string): ModelConfiguration | undefined {
    const model = this.values.get(id);
    return model === undefined ? undefined : structuredClone(model);
  }

  listModelConfigurations(): ModelConfiguration[] {
    return [...this.values.values()].map((model) => structuredClone(model));
  }

  deleteModelConfiguration(id: string): boolean {
    return this.values.delete(id);
  }
}

function available(model: ModelConfiguration): ModelConfiguration {
  const validating = beginModelValidation(model);
  if (!validating.ok) throw new Error('expected validation to start');
  const result = finishModelValidation(validating.value, {
    status: 'available',
    checkedAt: '2026-07-28T10:00:00.000Z',
    capabilities: { responses: false, streaming: true, toolCalls: true },
  });
  if (!result.ok) throw new Error('expected validation to finish');
  return result.value;
}

describe('ModelCatalogService', () => {
  it('enforces provider/model uniqueness and one enabled default without validation', () => {
    const repository = new MemoryModelRepository();
    const catalog = new ModelCatalogService(repository);
    const first = catalog.create({
      id: 'model-1',
      name: 'Model 1',
      providerProfileId: 'provider-1',
      modelId: 'shared-id',
      declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
    });
    catalog.create({
      id: 'model-2',
      name: 'Model 2',
      providerProfileId: 'provider-2',
      modelId: 'shared-id',
      declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
    });

    expect(() =>
      catalog.create({
        id: 'model-duplicate',
        name: 'Duplicate',
        providerProfileId: 'provider-1',
        modelId: 'shared-id',
        declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
      }),
    ).toThrowError(/model_configuration_exists/);

    catalog.setEnabled(first.id, true);
    catalog.setDefault(first.id, true);
    expect(catalog.listEligible()).toMatchObject([
      { id: 'model-1', enabled: true, isDefault: true, validation: { status: 'unverified' } },
    ]);
  });

  it('invalidates all models when their provider connection changes', () => {
    const repository = new MemoryModelRepository();
    const catalog = new ModelCatalogService(repository);
    const model = catalog.create({
      id: 'model-1',
      name: 'Model 1',
      providerProfileId: 'provider-1',
      modelId: 'model-1',
      declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
    });
    catalog.save(available(model));
    catalog.setEnabled(model.id, true);
    catalog.setDefault(model.id, true);

    expect(catalog.invalidateProvider('provider-1')).toBe(1);
    expect(catalog.get(model.id)).toMatchObject({
      enabled: true,
      isDefault: true,
      validation: { status: 'unverified' },
    });
  });

  it('imports discovered model ids idempotently as disabled and unverified', () => {
    const repository = new MemoryModelRepository();
    const catalog = new ModelCatalogService(repository, {
      createId: (modelId) => `id-${modelId}`,
    });

    expect(catalog.importDiscovered('provider-1', ['model-b', 'model-a', 'model-a'])).toEqual({
      created: ['id-model-a', 'id-model-b'],
      skipped: ['model-a'],
    });
    expect(catalog.importDiscovered('provider-1', ['model-a', 'model-c'])).toEqual({
      created: ['id-model-c'],
      skipped: ['model-a'],
    });
    expect(catalog.list()).toMatchObject([
      { modelId: 'model-a', enabled: false, validation: { status: 'unverified' } },
      { modelId: 'model-b', enabled: false, validation: { status: 'unverified' } },
      { modelId: 'model-c', enabled: false, validation: { status: 'unverified' } },
    ]);
  });
});
