import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

import type { ProviderProfile } from '@terminal-agent/domain';
import type { DiscoveredModel } from '@terminal-agent/protocol';

export type ProviderModelLister = (
  profile: ProviderProfile,
  secret: string,
  signal: AbortSignal,
) => AsyncIterable<DiscoveredModel>;

export class ProviderModelDiscoveryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'ProviderModelDiscoveryError';
  }
}

export class ProviderModelDiscoveryService {
  readonly #listModels: ProviderModelLister;
  readonly #maxModels: number;
  readonly #timeoutMs: number;
  readonly #controllers = new Map<string, AbortController>();

  constructor(
    options: { listModels?: ProviderModelLister; maxModels?: number; timeoutMs?: number } = {},
  ) {
    this.#listModels = options.listModels ?? listModelsWithOfficialSdk;
    this.#maxModels = options.maxModels ?? 500;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async discover(
    profile: ProviderProfile,
    secret: string,
  ): Promise<{ models: DiscoveredModel[]; truncated: boolean }> {
    const controller = new AbortController();
    this.#controllers.get(profile.id)?.abort();
    this.#controllers.set(profile.id, controller);
    const models = new Map<string, DiscoveredModel>();
    let truncated = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);
    try {
      for await (const candidate of this.#listModels(profile, secret, controller.signal)) {
        const id = candidate.id.trim();
        if (id.length === 0 || models.has(id)) continue;
        if (models.size >= this.#maxModels) {
          truncated = true;
          break;
        }
        models.set(id, { ...candidate, id });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ProviderModelDiscoveryError(
          timedOut ? 'model_discovery_timeout' : 'model_discovery_cancelled',
          timedOut ? '模型列表拉取超时。' : '模型列表拉取已取消。',
        );
      }
      throw new ProviderModelDiscoveryError(
        'model_discovery_failed',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      clearTimeout(timer);
      if (this.#controllers.get(profile.id) === controller) this.#controllers.delete(profile.id);
    }
    return {
      models: [...models.values()].sort((left, right) => left.id.localeCompare(right.id, 'en-US')),
      truncated,
    };
  }

  cancel(providerProfileId: string): boolean {
    const controller = this.#controllers.get(providerProfileId);
    if (controller === undefined) return false;
    controller.abort();
    return true;
  }
}

async function* listModelsWithOfficialSdk(
  profile: ProviderProfile,
  secret: string,
  signal: AbortSignal,
): AsyncIterable<DiscoveredModel> {
  const options = {
    apiKey: secret,
    baseURL: profile.baseUrl,
    defaultHeaders: { ...profile.extraHeaders },
    timeout: profile.timeoutMs,
    maxRetries: 0,
  };
  const page =
    profile.protocol === 'anthropic_messages'
      ? await new Anthropic(options).models.list({}, { signal })
      : await new OpenAI(options).models.list({ signal });
  for await (const raw of page as AsyncIterable<unknown>) {
    const model = normalizeDiscoveredModel(raw);
    if (model !== undefined) yield model;
  }
}

function normalizeDiscoveredModel(value: unknown): DiscoveredModel | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const model = value as Record<string, unknown>;
  if (typeof model.id !== 'string' || model.id.trim().length === 0) return undefined;
  const displayName = stringValue(model.display_name) ?? stringValue(model.displayName);
  const ownedBy = stringValue(model.owned_by) ?? stringValue(model.ownedBy);
  const createdAt =
    timestampValue(model.created_at) ??
    timestampValue(model.createdAt) ??
    timestampValue(model.created);
  return {
    id: model.id,
    ...(displayName === undefined ? {} : { displayName }),
    ...(ownedBy === undefined ? {} : { ownedBy }),
    ...(createdAt === undefined ? {} : { createdAt }),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function timestampValue(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * 1_000).toISOString();
  }
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}
