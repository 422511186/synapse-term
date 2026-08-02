import { join, resolve } from 'node:path';

import { buildUserScopedPipeName, type CoreIpcEndpointOptions } from '@synapse-term/infrastructure';

export interface DesktopCoreConfig {
  dataDirectory: string;
  pipeName: string;
  tokenPath: string;
}

export function getDesktopCoreConfig(
  dataDirectory: string,
  appId: string,
  username: string,
  endpointOptions?: CoreIpcEndpointOptions,
): DesktopCoreConfig {
  const root = resolve(dataDirectory);
  return {
    dataDirectory: root,
    pipeName: buildUserScopedPipeName(appId, username, endpointOptions),
    tokenPath: join(root, 'auth.token'),
  };
}
