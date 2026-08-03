import { randomUUID } from 'node:crypto';
import type { Socket } from 'node:net';

import {
  CURRENT_PROTOCOL_VERSION,
  ERROR_CODES,
  FrameDecoder,
  ServerHandshake,
  clientAuthenticationSchema,
  clientHelloSchema,
  coreServiceEventSchema,
  encodeControlFrame,
  encodeTerminalOutputFrame,
  parseCoreRequest,
  type CoreServiceEvent,
  type ProtocolError,
  type ProtocolVersion,
  type RequestEnvelope,
  type ResponseEnvelope,
} from '@synapse-term/protocol';

export interface CoreIpcServerOptions {
  coreInstanceId: string;
  token: string;
  protocolVersion?: ProtocolVersion;
  handleRequest(method: string, payload: unknown, connectionId: string): Promise<unknown>;
  onDisconnect?: (connectionId: string) => void;
  onConnectionCountChange?: (connectionCount: number) => void;
}

export function normalizeCoreResult(value: unknown): unknown {
  return value === undefined ? null : value;
}

export class CoreIpcServer {
  readonly #options: CoreIpcServerOptions;
  readonly #connections = new Set<CoreIpcConnection>();
  readonly #eventSequences = new Map<string, number>();
  #lastReportedConnectionCount: number | undefined;

  constructor(options: CoreIpcServerOptions) {
    if (options.coreInstanceId.trim().length === 0) {
      throw new RangeError('coreInstanceId must not be empty');
    }
    if (options.token.length === 0) throw new RangeError('token must not be empty');
    this.#options = options;
  }

  get connectionCount(): number {
    return this.#connections.size;
  }

  accept(socket: Socket): void {
    const connection = new CoreIpcConnection(socket, this.#options, (closedConnection) => {
      this.#connections.delete(closedConnection);
      this.#notifyConnectionCount();
    });
    this.#connections.add(connection);
    this.#notifyConnectionCount();
  }

  broadcastEvent(value: CoreServiceEvent): void {
    const event = coreServiceEventSchema.parse(value);
    const sequence = (this.#eventSequences.get(event.streamId) ?? 0) + 1;
    this.#eventSequences.set(event.streamId, sequence);
    for (const connection of this.#connections) {
      connection.sendEvent(event.streamId, sequence, event.type, event.payload);
    }
  }

  broadcastTerminalOutput(sessionId: string, sequence: number, data: Uint8Array): void {
    let frame: Uint8Array;
    try {
      frame = encodeTerminalOutputFrame({ sessionId, sequence, data });
    } catch (error) {
      if (isFrameTooLarge(error)) return;
      throw error;
    }
    for (const connection of this.#connections) connection.sendTerminalOutput(frame);
  }

  async close(): Promise<void> {
    const connections = [...this.#connections];
    this.#connections.clear();
    this.#notifyConnectionCount();
    await Promise.all(connections.map((connection) => connection.close()));
  }

  #notifyConnectionCount(): void {
    const count = this.#connections.size;
    if (this.#lastReportedConnectionCount === count) return;
    this.#lastReportedConnectionCount = count;
    this.#options.onConnectionCountChange?.(count);
  }
}

class CoreIpcConnection {
  readonly #socket: Socket;
  readonly #options: CoreIpcServerOptions;
  readonly #decoder = new FrameDecoder();
  readonly #handshake: ServerHandshake;
  readonly #onClose: (connection: CoreIpcConnection) => void;
  #authenticated = false;
  #connectionId: string | undefined;
  #protocolVersion: ProtocolVersion;
  #handshakeQueue: Promise<void> = Promise.resolve();
  #closed = false;

  constructor(
    socket: Socket,
    options: CoreIpcServerOptions,
    onClose: (connection: CoreIpcConnection) => void,
  ) {
    this.#socket = socket;
    this.#options = options;
    this.#onClose = onClose;
    this.#protocolVersion = options.protocolVersion ?? CURRENT_PROTOCOL_VERSION;
    this.#handshake = new ServerHandshake({
      coreInstanceId: options.coreInstanceId,
      token: options.token,
      protocolVersion: this.#protocolVersion,
    });
    socket.on('data', (chunk) => {
      let frames;
      try {
        frames = this.#decoder.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const frame of frames) {
        if (frame.kind !== 'control' || frame.envelope.kind !== 'request') {
          this.#socket.destroy();
          return;
        }
        const request = frame.envelope;
        if (!this.#authenticated) {
          this.#handshakeQueue = this.#handshakeQueue.then(() => this.#handleRequest(request));
          continue;
        }
        void this.#handleRequest(request);
      }
    });
    socket.once('close', () => this.#finishClose());
    socket.once('error', () => this.#finishClose());
  }

  sendEvent(streamId: string, sequence: number, event: string, payload: unknown): void {
    if (!this.#authenticated) return;
    try {
      this.#write(
        encodeControlFrame({
          kind: 'event',
          id: randomUUID(),
          protocolVersion: this.#protocolVersion,
          sentAt: new Date().toISOString(),
          streamId,
          sequence,
          event,
          payload: payload as never,
        }),
      );
    } catch (error) {
      // 广播事件没有可回复的 request，超大事件只能丢弃，不能让异常逃逸到 Core。
      if (!isFrameTooLarge(error)) this.#socket.destroy();
    }
  }

  sendTerminalOutput(frame: Uint8Array): void {
    if (!this.#authenticated) return;
    this.#write(frame);
  }

  async close(): Promise<void> {
    if (this.#closed || this.#socket.destroyed) {
      this.#finishClose();
      return;
    }
    await new Promise<void>((resolve) => {
      this.#socket.once('close', () => resolve());
      this.#socket.destroy();
    });
  }

  async #handleRequest(request: RequestEnvelope): Promise<void> {
    if (request.method === 'handshake.hello') {
      await this.#handleHello(request);
      return;
    }
    if (request.method === 'handshake.authenticate') {
      await this.#handleAuthentication(request);
      return;
    }
    if (!this.#authenticated || this.#connectionId === undefined) {
      this.#sendError(
        request,
        protocolError('authentication_failed', 'IPC authentication required'),
      );
      return;
    }

    let parsed;
    try {
      parsed = parseCoreRequest(request.method, request.payload);
    } catch {
      this.#sendError(request, protocolError('invalid_message', 'invalid Core request'));
      return;
    }
    try {
      const result = await this.#options.handleRequest(
        parsed.method,
        parsed.payload,
        this.#connectionId,
      );
      this.#sendSuccess(request, result);
    } catch (error) {
      this.#sendError(request, normalizeError(error));
    }
  }

  async #handleHello(request: RequestEnvelope): Promise<void> {
    if (this.#authenticated) {
      this.#sendError(request, protocolError('invalid_message', 'handshake is already complete'));
      return;
    }
    const parsed = clientHelloSchema.safeParse(request.payload);
    if (!parsed.success) {
      this.#sendError(request, protocolError('invalid_message', 'invalid client hello'));
      return;
    }
    const result = this.#handshake.acceptHello(parsed.data);
    if (!result.ok) {
      this.#sendError(request, protocolError(result.error, 'protocol version is incompatible'));
      return;
    }
    this.#protocolVersion = result.message.protocolVersion;
    this.#sendSuccess(request, result.message);
  }

  async #handleAuthentication(request: RequestEnvelope): Promise<void> {
    const parsed = clientAuthenticationSchema.safeParse(request.payload);
    if (!parsed.success) {
      this.#sendError(request, protocolError('authentication_failed', 'invalid authentication'));
      return;
    }
    const result = this.#handshake.acceptAuthentication(parsed.data);
    if (!result.ok) {
      this.#sendError(request, protocolError('authentication_failed', 'authentication failed'));
      return;
    }
    this.#authenticated = true;
    this.#connectionId = result.message.connectionId;
    this.#protocolVersion = result.message.protocolVersion;
    this.#sendSuccess(request, result.message);
  }

  #sendSuccess(request: RequestEnvelope, result: unknown): void {
    const response: ResponseEnvelope = {
      kind: 'response',
      id: randomUUID(),
      protocolVersion: this.#protocolVersion,
      sentAt: new Date().toISOString(),
      requestId: request.id,
      ok: true,
      result: normalizeCoreResult(result) as never,
    };
    this.#write(encodeControlFrame(response));
  }

  #sendError(request: RequestEnvelope, error: ProtocolError): void {
    const response: ResponseEnvelope = {
      kind: 'response',
      id: randomUUID(),
      protocolVersion: this.#protocolVersion,
      sentAt: new Date().toISOString(),
      requestId: request.id,
      ok: false,
      error,
    };
    this.#write(encodeControlFrame(response));
  }

  #write(frame: Uint8Array): void {
    if (this.#closed || this.#socket.destroyed) return;
    this.#socket.write(frame);
  }

  #finishClose(): void {
    if (this.#closed) return;
    this.#closed = true;
    const connectionId = this.#connectionId;
    this.#onClose(this);
    if (connectionId !== undefined) this.#options.onDisconnect?.(connectionId);
  }
}

function protocolError(code: ProtocolError['code'], message: string): ProtocolError {
  return { code, message, retryable: false };
}

function normalizeError(error: unknown): ProtocolError {
  const candidate = error as { code?: unknown; message?: unknown; retryable?: unknown };
  const rawCode =
    typeof candidate.code === 'string' && ERROR_CODES.includes(candidate.code as never)
      ? (candidate.code as ProtocolError['code'])
      : 'internal_error';
  const code = rawCode === 'frame_too_large' ? 'resource_exhausted' : rawCode;
  return {
    code,
    message: typeof candidate.message === 'string' ? candidate.message : String(error),
    retryable: candidate.retryable === true,
  };
}

function isFrameTooLarge(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'frame_too_large';
}
