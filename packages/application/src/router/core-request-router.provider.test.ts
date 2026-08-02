import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { withTemporaryDirectory } from '@synapse-term/test-kit';

import { CORE_MIGRATIONS } from '@synapse-term/infrastructure';
import { CoreRepositories } from '@synapse-term/infrastructure';
import { CoreRequestRouter } from './core-request-router.js';
import { ModelCatalogService } from '@synapse-term/model-providers';
import { OutputJournal } from '@synapse-term/terminal-service';
import { ProviderProfileService } from '@synapse-term/model-providers';
import { SqliteStore } from '@synapse-term/infrastructure';
import { SessionManager } from '@synapse-term/terminal-service';
import type { PtySpawner } from '@synapse-term/terminal-service';
import { ModelValidator } from '@synapse-term/model-providers';
import type { ModelAdapter, ModelEvent } from '@synapse-term/model-providers';

class EmptySpawner implements PtySpawner {
  spawn(): never {
    throw new Error('no sessions in provider test');
  }
}

class MemorySecrets {
  readonly values = new Map<string, string>();

  async set(reference: string, value: string): Promise<void> {
    this.values.set(reference, value);
  }

  async get(reference: string): Promise<string | undefined> {
    return this.values.get(reference);
  }

  async delete(reference: string): Promise<boolean> {
    return this.values.delete(reference);
  }
}

class ProbeAdapter implements ModelAdapter {
  async *stream(): AsyncIterable<ModelEvent> {
    yield { type: 'tool_call_started', id: 'probe-call', name: 'provider_probe' };
    yield {
      type: 'tool_call_completed',
      id: 'probe-call',
      name: 'provider_probe',
      argumentsJson: '{}',
    };
    yield { type: 'usage', inputTokens: 1, outputTokens: 1 };
    yield { type: 'turn_completed', stopReason: 'tool_call' };
  }
}

describe('CoreRequestRouter provider and model methods', () => {
  it('keeps credentials write-only and allows enabled models without validation', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      try {
        const repositories = new CoreRepositories(store);
        const secrets = new MemorySecrets();
        const providers = new ProviderProfileService(repositories);
        const models = new ModelCatalogService(repositories);
        const router = new CoreRequestRouter({
          sessions: new SessionManager(new EmptySpawner()),
          journal: new OutputJournal(),
          repositories,
          secrets,
          providers,
          models,
          modelValidator: new ModelValidator(),
          createAdapter: () => new ProbeAdapter(),
          emitTerminalOutput: () => undefined,
        });

        await router.handle(
          'provider.save',
          {
            profile: {
              id: 'provider-1',
              name: 'Operations',
              protocol: 'openai_responses',
              baseUrl: 'https://api.openai.com/v1',
              extraHeaders: {},
              timeoutMs: 30_000,
            },
            apiKey: 'secret-key',
          },
          'connection-1',
        );
        expect(await secrets.get('provider:provider-1')).toBe('secret-key');
        const providerViews = await router.handle('provider.list', {}, 'connection-1');
        expect(providerViews).toEqual([
          expect.objectContaining({
            id: 'provider-1',
            credentialConfigured: true,
            revision: 0,
          }),
        ]);
        expect(JSON.stringify(providerViews)).not.toContain('secret-key');
        expect(JSON.stringify(providerViews)).not.toContain('modelId');

        await router.handle(
          'model.save',
          {
            model: {
              id: 'model-1',
              name: 'GPT-5',
              providerProfileId: 'provider-1',
              modelId: 'gpt-5',
              contextWindowTokens: 128_000,
              maxOutputTokens: 8_192,
              autoCompact: true,
              compactThresholdPercent: 80,
              supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
              defaultReasoningEffort: 'medium',
              declaredCapabilities: { responses: true, streaming: true, toolCalls: true },
            },
          },
          'connection-1',
        );
        await expect(router.handle('model.list', {}, 'connection-1')).resolves.toEqual([
          expect.objectContaining({
            id: 'model-1',
            providerName: 'Operations',
            providerProtocol: 'openai_responses',
            enabled: false,
            status: 'unverified',
          }),
        ]);

        await expect(
          router.handle(
            'model.setEnabled',
            { modelConfigurationId: 'model-1', enabled: true },
            'connection-1',
          ),
        ).resolves.toMatchObject({ enabled: true });
        await expect(
          router.handle(
            'model.setDefault',
            { modelConfigurationId: 'model-1', isDefault: true },
            'connection-1',
          ),
        ).resolves.toMatchObject({ isDefault: true });
        await expect(
          router.handle('model.test', { modelConfigurationId: 'model-1' }, 'connection-1'),
        ).resolves.toMatchObject({
          id: 'model-1',
          enabled: true,
          isDefault: true,
          status: 'available',
          validation: { status: 'available', attempt: 1 },
        });

        await expect(
          router.handle('provider.remove', { providerId: 'provider-1' }, 'connection-1'),
        ).rejects.toThrow(/referenced/i);
        await expect(
          router.handle('model.remove', { modelConfigurationId: 'model-1' }, 'connection-1'),
        ).resolves.toBe(true);
        await expect(
          router.handle('provider.remove', { providerId: 'provider-1' }, 'connection-1'),
        ).resolves.toBe(true);
        expect(await secrets.get('provider:provider-1')).toBeUndefined();
      } finally {
        await store.close();
      }
    });
  });

  it('pulls provider models and imports selected ids as disabled configurations', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      try {
        const repositories = new CoreRepositories(store);
        const secrets = new MemorySecrets();
        let observedSecret = '';
        const router = new CoreRequestRouter({
          sessions: new SessionManager(new EmptySpawner()),
          journal: new OutputJournal(),
          repositories,
          secrets,
          providers: new ProviderProfileService(repositories),
          models: new ModelCatalogService(repositories, {
            createId: (modelId) => `imported-${modelId}`,
          }),
          modelDiscovery: {
            discover: async (_profile, secret) => {
              observedSecret = secret;
              return {
                models: [{ id: 'model-b' }, { id: 'model-a', displayName: 'Model A' }],
                truncated: false,
              };
            },
            cancel: () => true,
          },
          emitTerminalOutput: () => undefined,
        });
        await router.handle(
          'provider.save',
          {
            profile: {
              id: 'provider-1',
              name: 'Provider 1',
              protocol: 'openai_chat_completions',
              baseUrl: 'https://models.example.test/v1',
            },
            apiKey: 'secret-key',
          },
          'connection-1',
        );

        await expect(
          router.handle('provider.discoverModels', { providerId: 'provider-1' }, 'connection-1'),
        ).resolves.toEqual({
          providerProfileId: 'provider-1',
          models: [{ id: 'model-b' }, { id: 'model-a', displayName: 'Model A' }],
          truncated: false,
        });
        expect(observedSecret).toBe('secret-key');
        await expect(
          router.handle(
            'model.importDiscovered',
            { providerProfileId: 'provider-1', modelIds: ['model-b', 'model-a', 'model-a'] },
            'connection-1',
          ),
        ).resolves.toEqual({
          created: ['imported-model-a', 'imported-model-b'],
          skipped: ['model-a'],
        });
        await expect(router.handle('model.list', {}, 'connection-1')).resolves.toMatchObject([
          { modelId: 'model-a', enabled: false, status: 'unverified' },
          { modelId: 'model-b', enabled: false, status: 'unverified' },
        ]);
      } finally {
        await store.close();
      }
    });
  });
});
