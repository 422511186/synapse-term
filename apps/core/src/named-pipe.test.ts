import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { rm, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { buildUserScopedPipeName } from './core-paths.js';
import { NamedPipeServer } from './named-pipe.js';

describe('NamedPipeServer', () => {
  it.skipIf(process.platform === 'win32')(
    'replaces a stale POSIX endpoint left by a crashed Core',
    async () => {
      const pipeName = buildUserScopedPipeName(`stale-${randomUUID()}`, 'current-user');
      await writeFile(pipeName, 'stale endpoint', 'utf8');
      const server = new NamedPipeServer();

      try {
        await server.listen(pipeName, (socket) => socket.destroy());
      } finally {
        await server.close();
        await rm(pipeName, { force: true });
      }
    },
  );

  it.skipIf(process.platform === 'win32')('does not replace an active POSIX endpoint', async () => {
    const pipeName = buildUserScopedPipeName(`active-${randomUUID()}`, 'current-user');
    const active = new NamedPipeServer();
    const contender = new NamedPipeServer();
    await active.listen(pipeName, (socket) => socket.destroy());

    try {
      await expect(contender.listen(pipeName, (socket) => socket.destroy())).rejects.toMatchObject({
        code: 'EADDRINUSE',
      });
    } finally {
      await contender.close();
      await active.close();
      await rm(pipeName, { force: true });
    }
  });

  it.skipIf(process.platform !== 'win32')(
    'accepts a local user-scoped pipe connection',
    async () => {
      const pipeName = buildUserScopedPipeName(`test-${randomUUID()}`, 'current-user');
      const server = new NamedPipeServer();
      let received = '';
      await server.listen(pipeName, (socket) => {
        socket.on('data', (data) => {
          received += data.toString('utf8');
          socket.write('pong');
        });
      });

      const client = createConnection(pipeName);
      await once(client, 'connect');
      client.write('ping');
      const [data] = await once(client, 'data');

      expect(received).toBe('ping');
      expect(data.toString('utf8')).toBe('pong');
      client.destroy();
      await server.close();
    },
  );
});
