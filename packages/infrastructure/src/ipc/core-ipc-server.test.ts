import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';

import {
  CURRENT_PROTOCOL_VERSION,
  FrameDecoder,
  createAuthenticationProof,
  encodeControlFrame,
  type DecodedFrame,
  type RequestEnvelope,
} from '@synapse-term/protocol';

import { buildUserScopedPipeName } from '../paths/core-paths.js';
import { CoreIpcServer } from './core-ipc-server.js';
import * as coreIpcServer from './core-ipc-server.js';
import { NamedPipeServer } from './named-pipe.js';

function request(id: string, method: string, payload: unknown): RequestEnvelope {
  return {
    kind: 'request',
    id,
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    sentAt: new Date().toISOString(),
    method,
    payload: payload as never,
  };
}

class FrameInbox {
  readonly #frames: DecodedFrame[] = [];
  readonly #waiters: Array<(frame: DecodedFrame) => void> = [];
  readonly #decoder = new FrameDecoder();

  constructor(socket: Socket) {
    socket.on('data', (chunk) => {
      for (const frame of this.#decoder.push(
        typeof chunk === 'string' ? Buffer.from(chunk) : chunk,
      )) {
        const waiter = this.#waiters.shift();
        if (waiter === undefined) this.#frames.push(frame);
        else waiter(frame);
      }
    });
  }

  next(): Promise<DecodedFrame> {
    const frame = this.#frames.shift();
    if (frame !== undefined) return Promise.resolve(frame);
    return new Promise((resolve) => this.#waiters.push(resolve));
  }
}

async function nextFrameWithin(inbox: FrameInbox, timeoutMs: number): Promise<DecodedFrame> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      inbox.next(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Timed out waiting for IPC response')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function authenticateClient(socket: Socket, inbox: FrameInbox, token: string): Promise<void> {
  socket.write(
    encodeControlFrame(
      request('hello', 'handshake.hello', {
        kind: 'client_hello',
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        clientInstanceId: 'desktop-1',
      }),
    ),
  );
  const challengeFrame = await inbox.next();
  if (
    challengeFrame.kind !== 'control' ||
    challengeFrame.envelope.kind !== 'response' ||
    !challengeFrame.envelope.ok
  ) {
    throw new Error('expected handshake challenge');
  }
  const challenge = challengeFrame.envelope.result as {
    challenge: string;
    coreInstanceId: string;
    protocolVersion: typeof CURRENT_PROTOCOL_VERSION;
  };
  socket.write(
    encodeControlFrame(
      request('auth', 'handshake.authenticate', {
        kind: 'client_authentication',
        protocolVersion: challenge.protocolVersion,
        clientInstanceId: 'desktop-1',
        coreInstanceId: challenge.coreInstanceId,
        challenge: challenge.challenge,
        proof: createAuthenticationProof({
          token,
          challenge: challenge.challenge,
          clientInstanceId: 'desktop-1',
          coreInstanceId: challenge.coreInstanceId,
          protocolVersion: challenge.protocolVersion,
        }),
      }),
    ),
  );
  await expect(inbox.next()).resolves.toMatchObject({
    kind: 'control',
    envelope: { kind: 'response', requestId: 'auth', ok: true },
  });
}

describe('CoreIpcServer', () => {
  it('normalizes absent handler results to JSON null', () => {
    const normalize = (
      coreIpcServer as typeof coreIpcServer & {
        normalizeCoreResult?: (value: unknown) => unknown;
      }
    ).normalizeCoreResult;

    expect(normalize).toEqual(expect.any(Function));
    expect(normalize?.(undefined)).toBeNull();
    expect(normalize?.({ ok: true })).toEqual({ ok: true });
  });

  it('authenticates a client before routing requests and streaming events', async () => {
    const token = 'local-auth-token-with-at-least-32-bytes';
    const routed: Array<{ method: string; payload: unknown }> = [];
    const ipc = new CoreIpcServer({
      coreInstanceId: 'core-1',
      token,
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      handleRequest: async (method, payload) => {
        routed.push({ method, payload });
        return { connected: true, version: '0.1.0' };
      },
    });
    const transport = new NamedPipeServer();
    const pipeName = buildUserScopedPipeName(`ipc-${randomUUID()}`, 'current-user');
    await transport.listen(pipeName, (socket) => ipc.accept(socket));

    const socket = createConnection(pipeName);
    await once(socket, 'connect');
    const inbox = new FrameInbox(socket);
    socket.write(
      encodeControlFrame(
        request('hello', 'handshake.hello', {
          kind: 'client_hello',
          protocolVersion: CURRENT_PROTOCOL_VERSION,
          clientInstanceId: 'desktop-1',
        }),
      ),
    );
    const challengeFrame = await inbox.next();
    expect(challengeFrame).toMatchObject({
      kind: 'control',
      envelope: { kind: 'response', requestId: 'hello', ok: true },
    });
    if (
      challengeFrame.kind !== 'control' ||
      challengeFrame.envelope.kind !== 'response' ||
      !challengeFrame.envelope.ok
    ) {
      throw new Error('expected handshake challenge');
    }
    const challenge = challengeFrame.envelope.result as {
      challenge: string;
      coreInstanceId: string;
      protocolVersion: typeof CURRENT_PROTOCOL_VERSION;
    };
    socket.write(
      encodeControlFrame(
        request('auth', 'handshake.authenticate', {
          kind: 'client_authentication',
          protocolVersion: challenge.protocolVersion,
          clientInstanceId: 'desktop-1',
          coreInstanceId: challenge.coreInstanceId,
          challenge: challenge.challenge,
          proof: createAuthenticationProof({
            token,
            challenge: challenge.challenge,
            clientInstanceId: 'desktop-1',
            coreInstanceId: challenge.coreInstanceId,
            protocolVersion: challenge.protocolVersion,
          }),
        }),
      ),
    );
    await expect(inbox.next()).resolves.toMatchObject({
      kind: 'control',
      envelope: { kind: 'response', requestId: 'auth', ok: true },
    });

    socket.write(encodeControlFrame(request('status', 'core.status', {})));
    await expect(inbox.next()).resolves.toMatchObject({
      kind: 'control',
      envelope: {
        kind: 'response',
        requestId: 'status',
        ok: true,
        result: { connected: true, version: '0.1.0' },
      },
    });
    expect(routed).toEqual([{ method: 'core.status', payload: {} }]);

    ipc.broadcastEvent({
      type: 'core.status',
      streamId: 'core',
      payload: { connected: true, version: '0.1.0' },
    });
    await expect(inbox.next()).resolves.toMatchObject({
      kind: 'control',
      envelope: {
        kind: 'event',
        streamId: 'core',
        sequence: 1,
        event: 'core.status',
      },
    });

    ipc.broadcastTerminalOutput('session-1', 7, Buffer.from('hello'));
    const output = await inbox.next();
    expect(output).toMatchObject({ kind: 'terminal_output', sessionId: 'session-1', sequence: 7 });
    if (output.kind !== 'terminal_output') throw new Error('expected terminal output');
    expect(Buffer.from(output.data).toString('utf8')).toBe('hello');

    socket.destroy();
    await ipc.close();
    await transport.close();
  });

  it('rejects application requests before authentication', async () => {
    let routed = 0;
    const ipc = new CoreIpcServer({
      coreInstanceId: 'core-1',
      token: 'local-auth-token-with-at-least-32-bytes',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      handleRequest: async () => {
        routed += 1;
        return {};
      },
    });
    const transport = new NamedPipeServer();
    const pipeName = buildUserScopedPipeName(`ipc-${randomUUID()}`, 'current-user');
    await transport.listen(pipeName, (socket) => ipc.accept(socket));
    const socket = createConnection(pipeName);
    await once(socket, 'connect');
    const inbox = new FrameInbox(socket);

    socket.write(encodeControlFrame(request('status', 'core.status', {})));
    await expect(inbox.next()).resolves.toMatchObject({
      kind: 'control',
      envelope: {
        kind: 'response',
        requestId: 'status',
        ok: false,
        error: { code: 'authentication_failed' },
      },
    });
    expect(routed).toBe(0);

    socket.destroy();
    await ipc.close();
    await transport.close();
  });

  it('preserves router error codes such as invalid_session across IPC', async () => {
    const token = 'local-auth-token-with-at-least-32-bytes';
    const ipc = new CoreIpcServer({
      coreInstanceId: 'core-1',
      token,
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      handleRequest: async () => {
        throw Object.assign(new Error('无效的会话标识'), { code: 'invalid_session' });
      },
    });
    const transport = new NamedPipeServer();
    const pipeName = buildUserScopedPipeName(`ipc-${randomUUID()}`, 'current-user');
    await transport.listen(pipeName, (socket) => ipc.accept(socket));
    const socket = createConnection(pipeName);
    await once(socket, 'connect');
    const inbox = new FrameInbox(socket);

    socket.write(
      encodeControlFrame(
        request('hello', 'handshake.hello', {
          kind: 'client_hello',
          protocolVersion: CURRENT_PROTOCOL_VERSION,
          clientInstanceId: 'desktop-1',
        }),
      ),
    );
    const challengeFrame = await inbox.next();
    if (
      challengeFrame.kind !== 'control' ||
      challengeFrame.envelope.kind !== 'response' ||
      !challengeFrame.envelope.ok
    ) {
      throw new Error('expected handshake challenge');
    }
    const challenge = challengeFrame.envelope.result as {
      challenge: string;
      coreInstanceId: string;
      protocolVersion: typeof CURRENT_PROTOCOL_VERSION;
    };
    socket.write(
      encodeControlFrame(
        request('auth', 'handshake.authenticate', {
          kind: 'client_authentication',
          protocolVersion: challenge.protocolVersion,
          clientInstanceId: 'desktop-1',
          coreInstanceId: challenge.coreInstanceId,
          challenge: challenge.challenge,
          proof: createAuthenticationProof({
            token,
            challenge: challenge.challenge,
            clientInstanceId: 'desktop-1',
            coreInstanceId: challenge.coreInstanceId,
            protocolVersion: challenge.protocolVersion,
          }),
        }),
      ),
    );
    await expect(inbox.next()).resolves.toMatchObject({
      kind: 'control',
      envelope: { kind: 'response', requestId: 'auth', ok: true },
    });

    socket.write(
      encodeControlFrame(
        request('exec', 'external.terminalExecute', {
          sessionId: 'session-1',
          caller: { kind: 'mcp', id: 'mcp-client' },
          approvalMode: 'managed',
          command: 'ls',
        }),
      ),
    );
    await expect(inbox.next()).resolves.toMatchObject({
      kind: 'control',
      envelope: {
        kind: 'response',
        requestId: 'exec',
        ok: false,
        error: { code: 'invalid_session', message: '无效的会话标识' },
      },
    });

    socket.destroy();
    await ipc.close();
    await transport.close();
  });

  it('reports desktop client connection changes', async () => {
    const clientCounts: number[] = [];
    let resolveCoreDisconnect: (() => void) | undefined;
    const coreDisconnected = new Promise<void>((resolve) => {
      resolveCoreDisconnect = resolve;
    });
    const ipc = new CoreIpcServer({
      coreInstanceId: 'core-1',
      token: 'local-auth-token-with-at-least-32-bytes',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      handleRequest: async () => ({}),
      onConnectionCountChange: (count) => {
        clientCounts.push(count);
        if (count === 0) resolveCoreDisconnect?.();
      },
    });
    const transport = new NamedPipeServer();
    const pipeName = buildUserScopedPipeName(`ipc-${randomUUID()}`, 'current-user');
    await transport.listen(pipeName, (socket) => ipc.accept(socket));
    const socket = createConnection(pipeName);

    try {
      await once(socket, 'connect');
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(clientCounts).toEqual([1]);

      const disconnected = once(socket, 'close');
      socket.destroy();
      await disconnected;
      await coreDisconnected;
      expect(clientCounts).toEqual([1, 0]);
    } finally {
      socket.destroy();
      await ipc.close();
      await transport.close();
    }
  });

  it('keeps control requests responsive while an earlier resource refresh is pending', async () => {
    const token = 'local-auth-token-with-at-least-32-bytes';
    let releaseRefresh: (() => void) | undefined;
    let startedRefresh: (() => void) | undefined;
    const refreshStarted = new Promise<void>((resolve) => {
      startedRefresh = resolve;
    });
    const ipc = new CoreIpcServer({
      coreInstanceId: 'core-1',
      token,
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      handleRequest: async (method) => {
        if (method !== 'resources.refresh') return { method };
        startedRefresh?.();
        await new Promise<void>((resolve) => {
          releaseRefresh = resolve;
        });
        return { refreshed: true };
      },
    });
    const transport = new NamedPipeServer();
    const pipeName = buildUserScopedPipeName(`ipc-${randomUUID()}`, 'current-user');
    await transport.listen(pipeName, (socket) => ipc.accept(socket));
    const socket = createConnection(pipeName);
    await once(socket, 'connect');
    const inbox = new FrameInbox(socket);

    try {
      await authenticateClient(socket, inbox, token);
      socket.write(
        encodeControlFrame(request('refresh', 'resources.refresh', { sessionId: 'session-1' })),
      );
      await refreshStarted;
      socket.write(encodeControlFrame(request('status', 'core.status', {})));

      await expect(nextFrameWithin(inbox, 250)).resolves.toMatchObject({
        kind: 'control',
        envelope: {
          kind: 'response',
          requestId: 'status',
          ok: true,
          result: { method: 'core.status' },
        },
      });

      releaseRefresh?.();
      await expect(inbox.next()).resolves.toMatchObject({
        kind: 'control',
        envelope: {
          kind: 'response',
          requestId: 'refresh',
          ok: true,
          result: { refreshed: true },
        },
      });
    } finally {
      releaseRefresh?.();
      socket.destroy();
      await ipc.close();
      await transport.close();
    }
  });

  it('returns a bounded error for an oversized result and keeps the connection open', async () => {
    const token = 'local-auth-token-with-at-least-32-bytes';
    let statusCalls = 0;
    const ipc = new CoreIpcServer({
      coreInstanceId: 'core-1',
      token,
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      handleRequest: async (method) => {
        if (method !== 'core.status') return {};
        statusCalls += 1;
        return statusCalls === 1 ? { output: 'x'.repeat(8 * 1024 * 1024) } : { connected: true };
      },
    });
    const transport = new NamedPipeServer();
    const pipeName = buildUserScopedPipeName(`ipc-${randomUUID()}`, 'current-user');
    await transport.listen(pipeName, (socket) => ipc.accept(socket));
    const socket = createConnection(pipeName);
    await once(socket, 'connect');
    const inbox = new FrameInbox(socket);

    try {
      await authenticateClient(socket, inbox, token);
      socket.write(encodeControlFrame(request('large', 'core.status', {})));
      await expect(inbox.next()).resolves.toMatchObject({
        kind: 'control',
        envelope: {
          kind: 'response',
          requestId: 'large',
          ok: false,
          error: { code: 'resource_exhausted' },
        },
      });

      socket.write(encodeControlFrame(request('status', 'core.status', {})));
      await expect(inbox.next()).resolves.toMatchObject({
        kind: 'control',
        envelope: {
          kind: 'response',
          requestId: 'status',
          ok: true,
          result: { connected: true },
        },
      });
    } finally {
      socket.destroy();
      await ipc.close();
      await transport.close();
    }
  });
});
