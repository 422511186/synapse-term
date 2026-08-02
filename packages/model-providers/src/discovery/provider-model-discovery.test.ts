import { describe, expect, it } from 'vitest';

import { createProviderProfile } from '@synapse-term/domain';

import { ProviderModelDiscoveryService } from './provider-model-discovery.js';

const provider = createProviderProfile({
  id: 'provider-1',
  name: 'Provider 1',
  protocol: 'openai_chat_completions',
  baseUrl: 'https://models.example.test/v1',
  credentialRef: 'provider:provider-1',
  extraHeaders: {},
  timeoutMs: 30_000,
});

describe('ProviderModelDiscoveryService', () => {
  it('is a public Core service', () => {
    expect(ProviderModelDiscoveryService).toEqual(expect.any(Function));
  });

  it('deduplicates, sorts, and bounds discovered models', async () => {
    const Service = ProviderModelDiscoveryService as unknown as new (
      options: Record<string, unknown>,
    ) => {
      discover(
        profile: typeof provider,
        secret: string,
      ): Promise<{ models: Array<{ id: string }>; truncated: boolean }>;
    };
    const service = new Service({
      maxModels: 2,
      listModels: async function* () {
        yield { id: 'model-b', ownedBy: 'vendor' };
        yield { id: 'model-a', displayName: 'Model A' };
        yield { id: 'model-b', displayName: 'Duplicate' };
        yield { id: 'model-c' };
      },
    });

    await expect(service.discover(provider, 'secret-key')).resolves.toEqual({
      models: [
        { id: 'model-a', displayName: 'Model A' },
        { id: 'model-b', ownedBy: 'vendor' },
      ],
      truncated: true,
    });
  });

  it('maps cancellation and total timeout to stable discovery errors', async () => {
    const waitForAbort = async function* (
      _profile: typeof provider,
      _secret: string,
      signal: AbortSignal,
    ) {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          { once: true },
        );
      });
      yield { id: 'never' };
    };
    const Service = ProviderModelDiscoveryService;
    const cancellable = new Service({ listModels: waitForAbort });
    const cancelled = cancellable.discover(provider, 'secret-key');
    await Promise.resolve();
    expect(cancellable.cancel(provider.id)).toBe(true);
    await expect(cancelled).rejects.toThrow(/model_discovery_cancelled/);

    const timed = new Service({ listModels: waitForAbort, timeoutMs: 10 });
    await expect(timed.discover(provider, 'secret-key')).rejects.toThrow(/model_discovery_timeout/);
  });
});
