import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';

import { buildUserScopedPipeName, getCoreDataPaths } from './core-paths.js';

describe('core paths', () => {
  it('derives a deterministic user-scoped pipe without exposing username characters', () => {
    const alice = buildUserScopedPipeName('terminal-agent', 'Alice Example');
    const aliceAgain = buildUserScopedPipeName('terminal-agent', 'Alice Example');
    const bob = buildUserScopedPipeName('terminal-agent', 'Bob Example');

    expect(alice).toBe(aliceAgain);
    expect(alice).not.toBe(bob);
    expect(alice).toMatch(/ta-[a-f0-9]{32}\.sock$/);
    expect(alice).not.toContain('Alice');
  });

  it('keeps lock and pipe paths under the application data directory', () => {
    const paths = getCoreDataPaths(
      'C:/Users/test/AppData/Local/Terminal Agent',
      'terminal-agent',
      'user',
    );

    expect(paths.dataDirectory).toContain('Terminal Agent');
    expect(paths.lockPath.startsWith(paths.dataDirectory)).toBe(true);
    expect(paths.pipeName).toMatch(/ta-[a-f0-9]{32}\.sock$/);
  });

  it('uses a short bindable POSIX socket for long temporary directories and retains Windows pipe compatibility', async () => {
    const buildEndpoint = buildUserScopedPipeName as unknown as (
      appId: string,
      username: string,
      options: { platform: 'darwin' | 'win32'; temporaryDirectory: string },
    ) => string;
    const temporaryDirectory = `/private/var/folders/${'very-long-user-scoped-directory/'.repeat(8)}`;
    const posixEndpoint = buildEndpoint('terminal-agent', 'Alice Example', {
      platform: 'darwin',
      temporaryDirectory,
    });
    const windowsEndpoint = buildEndpoint('terminal-agent', 'Alice Example', {
      platform: 'win32',
      temporaryDirectory,
    });

    expect(posixEndpoint).toMatch(/^\/tmp\/ta-[a-f0-9]{32}\.sock$/);
    expect(Buffer.byteLength(posixEndpoint, 'utf8')).toBeLessThanOrEqual(100);
    expect(windowsEndpoint).toMatch(/^\\\\\.\\pipe\\terminal-agent-/);

    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(posixEndpoint, resolve);
    });
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
});
