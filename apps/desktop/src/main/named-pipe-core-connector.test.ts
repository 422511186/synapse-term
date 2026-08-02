import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { CURRENT_PROTOCOL_VERSION } from '@synapse-term/protocol';

import { buildUserScopedPipeName } from '@synapse-term/infrastructure';
import { CoreIpcServer } from '@synapse-term/infrastructure';
import { NamedPipeServer } from '@synapse-term/infrastructure';

import { CoreRequestError, NamedPipeCoreConnector } from './named-pipe-core-connector.js';

describe('NamedPipeCoreConnector', () => {
  it('authenticates, correlates requests, and separates control and terminal streams', async () => {
    const token = 'local-auth-token-with-at-least-32-bytes';
    const ipc = new CoreIpcServer({
      coreInstanceId: 'core-1',
      token,
      handleRequest: async (method) => {
        if (method === 'core.status') return { connected: true, version: '0.1.0' };
        throw Object.assign(new Error('not found'), { code: 'request_not_found' });
      },
    });
    const server = new NamedPipeServer();
    const pipeName = buildUserScopedPipeName(`connector-${randomUUID()}`, 'current-user');
    await server.listen(pipeName, (socket) => ipc.accept(socket));
    const connector = new NamedPipeCoreConnector({
      pipeName,
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      clientInstanceId: 'desktop-1',
      loadToken: async () => token,
    });

    const connection = await connector.connect();
    await expect(connection.handshake()).resolves.toEqual({
      ok: true,
      version: CURRENT_PROTOCOL_VERSION,
    });
    await expect(connection.request('core.status', {})).resolves.toEqual({
      connected: true,
      version: '0.1.0',
    });

    const events: unknown[] = [];
    const outputs: unknown[] = [];
    connection.onEvent((event) => events.push(event));
    connection.onTerminalOutput((event) => outputs.push(event));
    ipc.broadcastEvent({
      type: 'core.status',
      streamId: 'core',
      payload: { connected: true, version: '0.1.0' },
    });
    ipc.broadcastTerminalOutput('session-1', 9, Buffer.from('ready'));
    await vi.waitFor(() => {
      expect(events).toHaveLength(1);
      expect(outputs).toHaveLength(1);
    });
    expect(events[0]).toMatchObject({ event: 'core.status', streamId: 'core', sequence: 1 });
    expect(outputs[0]).toMatchObject({ sessionId: 'session-1', sequence: 9, data: 'ready' });

    await expect(connection.request('filesystem.read', {})).rejects.toMatchObject({
      code: 'invalid_message',
    });
    await connection.close();
    await ipc.close();
    await server.close();
  });

  it('returns authentication failure without exposing the token', async () => {
    const ipc = new CoreIpcServer({
      coreInstanceId: 'core-1',
      token: 'correct-local-auth-token-with-at-least-32-bytes',
      handleRequest: async () => ({}),
    });
    const server = new NamedPipeServer();
    const pipeName = buildUserScopedPipeName(`connector-${randomUUID()}`, 'current-user');
    await server.listen(pipeName, (socket) => ipc.accept(socket));
    const connection = await new NamedPipeCoreConnector({
      pipeName,
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      clientInstanceId: 'desktop-1',
      loadToken: async () => 'wrong-local-auth-token-with-at-least-32-bytes',
    }).connect();

    await expect(connection.handshake()).resolves.toEqual({
      ok: false,
      error: 'authentication_failed',
    });
    await expect(connection.request('core.status', {})).rejects.toBeInstanceOf(CoreRequestError);

    await connection.close();
    await ipc.close();
    await server.close();
  });
});
