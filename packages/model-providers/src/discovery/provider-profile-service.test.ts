import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { beginModelValidation, finishModelValidation } from '@synapse-term/domain';
import { withTemporaryDirectory } from '@synapse-term/test-kit';

import { CORE_MIGRATIONS } from '@synapse-term/infrastructure';
import { ModelCatalogService } from './model-catalog-service.js';
import { ProviderProfileService } from './provider-profile-service.js';
import { CoreRepositories } from '@synapse-term/infrastructure';
import { SqliteStore } from '@synapse-term/infrastructure';

const input = {
  id: 'provider-1',
  name: 'Compatible',
  protocol: 'openai_chat_completions' as const,
  baseUrl: 'https://llm.example.test/v1',
  credentialRef: 'credential:provider-1',
  extraHeaders: {},
  timeoutMs: 30_000,
};

describe('ProviderProfileService', () => {
  it('creates, updates, lists, and deletes connection profiles', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      try {
        const repositories = new CoreRepositories(store);
        const service = new ProviderProfileService(
          repositories,
          new ModelCatalogService(repositories),
        );

        expect(service.create(input)).toMatchObject({ id: 'provider-1', revision: 0 });
        expect(service.update('provider-1', { name: 'Renamed', timeoutMs: 45_000 })).toMatchObject({
          name: 'Renamed',
          timeoutMs: 45_000,
          revision: 1,
        });
        expect(service.list()).toHaveLength(1);
        expect(service.delete('provider-1')).toBe(true);
        expect(service.get('provider-1')).toBeUndefined();
      } finally {
        await store.close();
      }
    });
  });

  it('invalidates referenced models when connection settings change', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      try {
        const repositories = new CoreRepositories(store);
        const models = new ModelCatalogService(repositories);
        const service = new ProviderProfileService(repositories, models);
        service.create(input);
        const model = models.create({
          id: 'model-1',
          name: 'Model 1',
          providerProfileId: input.id,
          modelId: 'model-1',
          declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
        });
        const validating = beginModelValidation(model);
        if (!validating.ok) throw new Error('expected validation to start');
        const available = finishModelValidation(validating.value, {
          status: 'available',
          checkedAt: '2026-07-28T10:00:00.000Z',
          capabilities: { responses: false, streaming: true, toolCalls: true },
        });
        if (!available.ok) throw new Error('expected validation to finish');
        models.save(available.value);
        models.setEnabled(model.id, true);

        service.update(input.id, { baseUrl: 'https://new.example.test/v1' });
        expect(models.get(model.id)).toMatchObject({
          enabled: true,
          isDefault: false,
          validation: { status: 'unverified' },
        });
      } finally {
        await store.close();
      }
    });
  });

  it('blocks deleting a provider referenced by model configurations', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      try {
        const repositories = new CoreRepositories(store);
        const models = new ModelCatalogService(repositories);
        const service = new ProviderProfileService(repositories, models);
        service.create(input);
        models.create({
          id: 'model-1',
          name: 'Model 1',
          providerProfileId: input.id,
          modelId: 'model-1',
          declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
        });

        expect(() => service.delete(input.id)).toThrow(/provider_profile_referenced/);
      } finally {
        await store.close();
      }
    });
  });
});
