import type { ModelConfigurationView, ProviderProfileView } from '../../preload/preload-api.js';

export const PROVIDER_SEARCH_THRESHOLD = 15;
export const REMOTE_MODEL_PAGE_SIZE = 10;

export type ModelConfigurationStatusFilter =
  'all' | 'enabled' | 'disabled' | 'available' | 'unavailable' | 'validating' | 'unverified';

export interface ModelConfigurationFilters {
  query: string;
  providerId: string;
  status: ModelConfigurationStatusFilter;
}

export function filterProviderProfiles(
  providers: ProviderProfileView[],
  query: string,
): ProviderProfileView[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) return providers;
  return providers.filter((provider) =>
    [provider.name, provider.protocol, provider.baseUrl].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    ),
  );
}

export function filterModelConfigurations(
  models: ModelConfigurationView[],
  filters: ModelConfigurationFilters,
): ModelConfigurationView[] {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase();
  return models.filter((model) => {
    const matchesQuery =
      normalizedQuery.length === 0 ||
      [model.name, model.modelId, model.providerName].some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery),
      );
    const matchesProvider =
      filters.providerId === 'all' || model.providerProfileId === filters.providerId;
    const matchesStatus = matchesModelStatus(model, filters.status);
    return matchesQuery && matchesProvider && matchesStatus;
  });
}

export function paginateItems<T>(
  items: T[],
  requestedPage: number,
  pageSize: number,
): { items: T[]; page: number; pageCount: number } {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
  const page = Math.min(Math.max(0, Math.floor(requestedPage)), pageCount - 1);
  return {
    items: items.slice(page * safePageSize, (page + 1) * safePageSize),
    page,
    pageCount,
  };
}

function matchesModelStatus(
  model: ModelConfigurationView,
  status: ModelConfigurationStatusFilter,
): boolean {
  switch (status) {
    case 'all':
      return true;
    case 'enabled':
      return model.enabled;
    case 'disabled':
      return !model.enabled;
    default:
      return model.status === status;
  }
}
