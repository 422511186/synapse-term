/**
 * Provider 请求处理
 *
 * provider.* 用例：档案列表/保存/删除与模型发现。凭据只经引用读写，
 * 返回视图统一脱敏（credentialConfigured 布尔，不含密钥）。
 */
import type { ProviderProfile } from '@synapse-term/domain';
import type { AuditRecordInput } from '@synapse-term/infrastructure';
import type { ProviderProfileService, ProviderProfileUpdate } from '@synapse-term/model-providers';

import { routerError } from '../contracts.js';
import type { AuditQueryLike, CoreSecretStore, ProviderModelDiscoveryLike } from '../contracts.js';

export interface ProviderRequestHandlerOptions {
  providers?: ProviderProfileService | undefined;
  secrets?: CoreSecretStore | undefined;
  modelDiscovery?: ProviderModelDiscoveryLike | undefined;
  audit?: AuditQueryLike | undefined;
}

export class ProviderRequestHandler {
  readonly #providers: ProviderProfileService | undefined;
  readonly #secrets: CoreSecretStore | undefined;
  readonly #modelDiscovery: ProviderModelDiscoveryLike | undefined;
  readonly #audit: AuditQueryLike | undefined;

  constructor(options: ProviderRequestHandlerOptions) {
    this.#providers = options.providers;
    this.#secrets = options.secrets;
    this.#modelDiscovery = options.modelDiscovery;
    this.#audit = options.audit;
  }

  async listProviders(): Promise<unknown[]> {
    const secrets = this.#secrets;
    return Promise.all(
      this.#requireProviders()
        .list()
        .map(async (profile) =>
          this.#providerView(
            profile,
            secrets === undefined
              ? false
              : (await secrets.get(profile.credentialRef)) !== undefined,
          ),
        ),
    );
  }

  async saveProvider(
    input: {
      id: string;
      name: string;
      protocol: ProviderProfile['protocol'];
      baseUrl: string;
      extraHeaders?: Readonly<Record<string, string>> | undefined;
      timeoutMs?: number | undefined;
    },
    apiKey?: string | undefined,
  ): Promise<null> {
    const providers = this.#requireProviders();
    const current = providers.get(input.id);
    if (current === undefined) {
      providers.create({
        id: input.id,
        name: input.name,
        protocol: input.protocol,
        baseUrl: input.baseUrl,
        credentialRef: `provider:${input.id}`,
        extraHeaders: input.extraHeaders ?? {},
        timeoutMs: input.timeoutMs ?? 30_000,
      });
    } else {
      const update: ProviderProfileUpdate = {
        name: input.name,
        protocol: input.protocol,
        baseUrl: input.baseUrl,
        extraHeaders: input.extraHeaders ?? {},
        timeoutMs: input.timeoutMs ?? 30_000,
      };
      providers.update(input.id, update);
    }
    if (apiKey !== undefined) await this.#requireSecrets().set(`provider:${input.id}`, apiKey);
    this.#recordAudit({
      actor: { kind: 'user' },
      type: current === undefined ? 'provider.created' : 'provider.updated',
      payload: { providerId: input.id, protocol: input.protocol },
    });
    return null;
  }

  async removeProvider(providerId: string): Promise<boolean> {
    const profile = this.#requireProviders().get(providerId);
    if (profile === undefined) return false;
    const removed = this.#requireProviders().delete(providerId);
    await this.#requireSecrets().delete(profile.credentialRef);
    if (removed) {
      this.#recordAudit({
        actor: { kind: 'user' },
        type: 'provider.removed',
        payload: { providerId },
      });
    }
    return removed;
  }

  async discoverModels(providerId: string): Promise<unknown> {
    const profile = this.#requireProvider(providerId);
    const secret = await this.#requireSecrets().get(profile.credentialRef);
    if (secret === undefined)
      throw routerError('provider_unavailable', 'Provider credential is missing');
    if (this.#modelDiscovery === undefined) {
      throw routerError('provider_unavailable', 'Model discovery is not configured');
    }
    const result = await this.#modelDiscovery.discover(profile, secret);
    return { providerProfileId: providerId, ...result };
  }

  cancelModelDiscovery(providerId: string): boolean {
    return this.#modelDiscovery?.cancel(providerId) ?? false;
  }

  #providerView(
    profile: ProviderProfile,
    credentialConfigured: boolean,
  ): {
    id: string;
    name: string;
    protocol: ProviderProfile['protocol'];
    baseUrl: string;
    extraHeaders: Readonly<Record<string, string>>;
    timeoutMs: number;
    credentialConfigured: boolean;
    revision: number;
  } {
    return {
      id: profile.id,
      name: profile.name,
      protocol: profile.protocol,
      baseUrl: profile.baseUrl,
      extraHeaders: profile.extraHeaders,
      timeoutMs: profile.timeoutMs,
      credentialConfigured,
      revision: profile.revision,
    };
  }

  #requireProviders(): ProviderProfileService {
    if (this.#providers === undefined)
      throw routerError('provider_unavailable', 'Provider service is not configured');
    return this.#providers;
  }

  #requireProvider(id: string): ProviderProfile {
    const provider = this.#requireProviders().get(id);
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
