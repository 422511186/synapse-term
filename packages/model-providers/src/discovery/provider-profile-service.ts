import {
  createProviderProfile,
  updateProviderProfile,
  type CreateProviderProfileInput,
  type ProviderProfile,
  type ProviderProfileUpdate,
} from '@synapse-term/domain';

import type { ModelCatalogService } from './model-catalog-service.js';
import type { CoreRepositories } from '@synapse-term/infrastructure';

export { type ProviderProfileUpdate } from '@synapse-term/domain';

export class ProviderProfileService {
  readonly #repositories: CoreRepositories;
  readonly #models: Pick<ModelCatalogService, 'invalidateProvider' | 'listByProvider'> | undefined;

  constructor(
    repositories: CoreRepositories,
    models?: Pick<ModelCatalogService, 'invalidateProvider' | 'listByProvider'>,
  ) {
    this.#repositories = repositories;
    this.#models = models;
  }

  create(input: CreateProviderProfileInput): ProviderProfile {
    if (this.#repositories.getProviderProfile(input.id) !== undefined) {
      throw new Error(`provider_profile_exists: Provider Profile ${input.id} already exists`);
    }
    const profile = createProviderProfile(input);
    this.#repositories.saveProviderProfile(profile);
    return profile;
  }

  get(id: string): ProviderProfile | undefined {
    return this.#repositories.getProviderProfile(id);
  }

  list(): ProviderProfile[] {
    return this.#repositories.listProviderProfiles();
  }

  update(id: string, update: ProviderProfileUpdate): ProviderProfile {
    const current = this.#repositories.getProviderProfile(id);
    if (current === undefined) {
      throw new Error(`provider_profile_not_found: Provider Profile ${id} not found`);
    }
    const next = updateProviderProfile(current, update);
    this.#repositories.saveProviderProfile(next);
    this.#models?.invalidateProvider(id);
    return next;
  }

  delete(id: string): boolean {
    if (this.#repositories.getProviderProfile(id) === undefined) return false;
    const referencedModels =
      this.#models?.listByProvider(id) ?? this.#repositories.listModelConfigurations(id);
    if (referencedModels.length > 0) {
      throw new Error(
        `provider_profile_referenced: Provider Profile ${id} is referenced by ${referencedModels
          .map((model) => model.id)
          .join(', ')}`,
      );
    }
    const activeLegacyTask = this.#repositories
      .listAgentTasks()
      .find(
        (task) =>
          task.providerProfileId === id &&
          !['completed', 'failed', 'cancelled'].includes(task.status),
      );
    if (activeLegacyTask !== undefined) {
      throw new Error(
        `provider_profile_referenced: Provider Profile ${id} is used by active task ${activeLegacyTask.id}`,
      );
    }
    return this.#repositories.deleteProviderProfile(id);
  }
}
