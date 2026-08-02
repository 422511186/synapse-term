import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX_POSIX_SOCKET_PATH_BYTES = 100;

export interface CoreIpcEndpointOptions {
  platform?: NodeJS.Platform;
  temporaryDirectory?: string;
}

export function normalizeAppId(appId: string): string {
  const value = appId.trim().replace(/[^A-Za-z0-9._-]/g, '-');
  if (value.length === 0) throw new RangeError('appId must contain a safe character');
  return value;
}

function userScope(username: string): string {
  const value = username.trim();
  if (value.length === 0) throw new RangeError('username must not be empty');
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

export function buildUserScopedPipeName(
  appId: string,
  username: string,
  options: CoreIpcEndpointOptions = {},
): string {
  const safeAppId = normalizeAppId(appId);
  const scope = userScope(username);
  if ((options.platform ?? process.platform) === 'win32') {
    return `\\\\.\\pipe\\${safeAppId}-${scope}`;
  }

  const endpointHash = createHash('sha256')
    .update(`${safeAppId}\u0000${scope}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  const socketName = `ta-${endpointHash}.sock`;
  const preferred = join(options.temporaryDirectory ?? tmpdir(), socketName);
  return Buffer.byteLength(preferred, 'utf8') <= MAX_POSIX_SOCKET_PATH_BYTES
    ? preferred
    : join('/tmp', socketName);
}
