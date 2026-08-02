import { join, resolve } from 'node:path';

import {
  buildUserScopedPipeName as deriveUserScopedPipeName,
  normalizeAppId,
} from '../ipc/core-ipc-endpoint.js';

export { buildUserScopedPipeName } from '../ipc/core-ipc-endpoint.js';

export interface CoreDataPaths {
  dataDirectory: string;
  lockPath: string;
  pipeName: string;
}

export function getCoreDataPaths(
  dataDirectory: string,
  appId: string,
  username: string,
): CoreDataPaths {
  const resolvedDataDirectory = resolve(dataDirectory);
  return {
    dataDirectory: resolvedDataDirectory,
    lockPath: join(resolvedDataDirectory, `${normalizeAppId(appId)}.core.lock`),
    pipeName: deriveUserScopedPipeName(appId, username),
  };
}
