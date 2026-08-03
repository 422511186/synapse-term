import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { CURRENT_PROTOCOL_VERSION, MAX_TERMINAL_OUTPUT_CHUNK_BYTES } from '@synapse-term/protocol';

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

  it('keeps the authenticated connection usable after an oversized response', async () => {
    const token = 'local-auth-token-with-at-least-32-bytes';
    let statusCalls = 0;
    const ipc = new CoreIpcServer({
      coreInstanceId: 'core-1',
      token,
      handleRequest: async (method) => {
        if (method !== 'core.status') return {};
        statusCalls += 1;
        if (statusCalls === 1) return { output: 'x'.repeat(8 * 1024 * 1024) };
        return { connected: true };
      },
    });
    const server = new NamedPipeServer();
    const pipeName = buildUserScopedPipeName(`connector-${randomUUID()}`, 'current-user');
    await server.listen(pipeName, (socket) => ipc.accept(socket));
    const connection = await new NamedPipeCoreConnector({
      pipeName,
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      clientInstanceId: 'desktop-1',
      loadToken: async () => token,
    }).connect();

    try {
      await expect(connection.handshake()).resolves.toMatchObject({ ok: true });
      await expect(connection.request('core.status', {})).rejects.toMatchObject({
        code: 'resource_exhausted',
      });
      await expect(connection.request('core.status', {})).resolves.toEqual({ connected: true });
    } finally {
      await connection.close();
      await ipc.close();
      await server.close();
    }
  });

  it('keeps session close responsive while receiving a multi-frame large output stream', async () => {
    const token = 'local-auth-token-with-at-least-32-bytes';
    const outputChunk = Buffer.alloc(MAX_TERMINAL_OUTPUT_CHUNK_BYTES, 97);
    const outputChunkCount = 33;
    const ipc = new CoreIpcServer({
      coreInstanceId: 'core-1',
      token,
      handleRequest: async (method) => {
        if (method === 'session.close') {
          for (let index = 0; index < outputChunkCount; index += 1) {
            ipc.broadcastTerminalOutput('session-1', index + 1, outputChunk);
          }
          return true;
        }
        if (method === 'session.list') return [];
        return {};
      },
    });
    const server = new NamedPipeServer();
    const pipeName = buildUserScopedPipeName(`connector-${randomUUID()}`, 'current-user');
    await server.listen(pipeName, (socket) => ipc.accept(socket));
    const connection = await new NamedPipeCoreConnector({
      pipeName,
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      clientInstanceId: 'desktop-1',
      loadToken: async () => token,
    }).connect();

    try {
      await expect(connection.handshake()).resolves.toMatchObject({ ok: true });
      const outputs: string[] = [];
      connection.onTerminalOutput((event) => outputs.push(event.data));
      await expect(connection.request('session.close', { sessionId: 'session-1' })).resolves.toBe(
        true,
      );
      await vi.waitFor(() => expect(outputs).toHaveLength(outputChunkCount));
      expect(Buffer.byteLength(outputs.join(''), 'utf8')).toBe(
        outputChunk.byteLength * outputChunkCount,
      );
      await expect(connection.request('session.list', {})).resolves.toEqual([]);
    } finally {
      await connection.close();
      await ipc.close();
      await server.close();
    }
  });
});
