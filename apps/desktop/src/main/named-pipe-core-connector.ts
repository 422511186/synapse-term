import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';

import {
  FrameDecoder,
  createAuthenticationProof,
  encodeControlFrame,
  serverChallengeSchema,
  serverWelcomeSchema,
  type EventEnvelope,
  type ProtocolError,
  type ProtocolVersion,
  type RequestEnvelope,
} from '@synapse-term/protocol';

import type {
  CoreConnection,
  CoreConnector,
  CoreHandshakeFailure,
  CoreHandshakeResult,
  CoreTerminalOutput,
} from './core-supervisor.js';

export interface NamedPipeCoreConnectorOptions {
  pipeName: string;
  protocolVersion: ProtocolVersion;
  clientInstanceId: string;
  loadToken(): Promise<string | undefined>;
  requestTimeoutMs?: number;
}

export class CoreRequestError extends Error {
  readonly code: ProtocolError['code'];
  readonly retryable: boolean;
  readonly details: ProtocolError['details'];

  constructor(error: ProtocolError) {
    super(error.message);
    this.name = 'CoreRequestError';
    this.code = error.code;
    this.retryable = error.retryable;
    this.details = error.details;
  }
}

export class NamedPipeCoreConnector implements CoreConnector {
  readonly #options: NamedPipeCoreConnectorOptions;

  constructor(options: NamedPipeCoreConnectorOptions) {
    if (options.pipeName.trim().length === 0) throw new RangeError('pipeName must not be empty');
    if (options.clientInstanceId.trim().length === 0) {
      throw new RangeError('clientInstanceId must not be empty');
    }
    const timeout = options.requestTimeoutMs ?? 30_000;
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new RangeError('requestTimeoutMs must be a positive finite number');
    }
    this.#options = { ...options, requestTimeoutMs: timeout };
  }

  async connect(): Promise<CoreConnection> {
    const socket = createConnection(this.#options.pipeName);
    await new Promise<void>((resolve, reject) => {
      const onConnect = (): void => {
        socket.off('error', onError);
        resolve();
      };
      const onError = (error: Error): void => {
        socket.off('connect', onConnect);
        reject(error);
      };
      socket.once('connect', onConnect);
      socket.once('error', onError);
    }).catch((error) => {
      socket.destroy();
      throw error;
    });
    return new NamedPipeCoreConnection(socket, this.#options);
  }
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
}

class NamedPipeCoreConnection implements CoreConnection {
  readonly #socket: Socket;
  readonly #options: NamedPipeCoreConnectorOptions & { requestTimeoutMs: number };
  readonly #decoder = new FrameDecoder();
  readonly #pending = new Map<string, PendingRequest>();
  readonly #eventListeners = new Set<(event: EventEnvelope) => void>();
  readonly #terminalListeners = new Set<(event: CoreTerminalOutput) => void>();
  readonly #disconnectListeners = new Set<() => void>();
  #handshakePromise: Promise<CoreHandshakeResult | CoreHandshakeFailure> | undefined;
  #authenticated = false;
  #closed = false;

  constructor(
    socket: Socket,
    options: NamedPipeCoreConnectorOptions & { requestTimeoutMs?: number },
  ) {
    this.#socket = socket;
    this.#options = { ...options, requestTimeoutMs: options.requestTimeoutMs ?? 30_000 };
    socket.on('data', (chunk) => {
      try {
        for (const frame of this.#decoder.push(
          typeof chunk === 'string' ? Buffer.from(chunk) : chunk,
        )) {
          if (frame.kind === 'terminal_output') {
            const event = {
              sessionId: frame.sessionId,
              sequence: frame.sequence,
              data: Buffer.from(frame.data).toString('utf8'),
            };
            for (const listener of this.#terminalListeners) listener(event);
            continue;
          }
          const envelope = frame.envelope;
          if (envelope.kind === 'event') {
            for (const listener of this.#eventListeners) listener(envelope);
            continue;
          }
          if (envelope.kind !== 'response') continue;
          const pending = this.#pending.get(envelope.requestId);
          if (pending === undefined) continue;
          this.#pending.delete(envelope.requestId);
          clearTimeout(pending.timer);
          if (envelope.ok) pending.resolve(envelope.result);
          else pending.reject(new CoreRequestError(envelope.error));
        }
      } catch (error) {
        this.#finishDisconnect(error);
        socket.destroy();
      }
    });
    socket.once('close', () => this.#finishDisconnect(new Error('Core connection closed')));
    socket.once('error', (error) => this.#finishDisconnect(error));
  }

  handshake(): Promise<CoreHandshakeResult | CoreHandshakeFailure> {
    this.#handshakePromise ??= this.#performHandshake();
    return this.#handshakePromise;
  }

  async request<T>(method: string, payload: unknown): Promise<T> {
    if (!this.#authenticated) {
      throw new CoreRequestError({
        code: 'authentication_failed',
        message: 'Core handshake has not completed',
        retryable: false,
      });
    }
    return (await this.#request(method, payload)) as T;
  }

  onEvent(listener: (event: EventEnvelope) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  onTerminalOutput(listener: (event: CoreTerminalOutput) => void): () => void {
    this.#terminalListeners.add(listener);
    return () => this.#terminalListeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.#disconnectListeners.add(listener);
    return () => this.#disconnectListeners.delete(listener);
  }

  async close(): Promise<void> {
    if (this.#closed || this.#socket.destroyed) {
      this.#finishDisconnect(new Error('Core connection closed'));
      return;
    }
    await new Promise<void>((resolve) => {
      this.#socket.once('close', () => resolve());
      this.#socket.destroy();
    });
  }

  async #performHandshake(): Promise<CoreHandshakeResult | CoreHandshakeFailure> {
    try {
      const challenge = serverChallengeSchema.parse(
        await this.#request('handshake.hello', {
          kind: 'client_hello',
          protocolVersion: this.#options.protocolVersion,
          clientInstanceId: this.#options.clientInstanceId,
        }),
      );
      const token = await this.#options.loadToken();
      if (token === undefined) return { ok: false, error: 'authentication_failed' };
      const welcome = serverWelcomeSchema.parse(
        await this.#request('handshake.authenticate', {
          kind: 'client_authentication',
          protocolVersion: challenge.protocolVersion,
          clientInstanceId: this.#options.clientInstanceId,
          coreInstanceId: challenge.coreInstanceId,
          challenge: challenge.challenge,
          proof: createAuthenticationProof({
            token,
            challenge: challenge.challenge,
            clientInstanceId: this.#options.clientInstanceId,
            coreInstanceId: challenge.coreInstanceId,
            protocolVersion: challenge.protocolVersion,
          }),
        }),
      );
      this.#authenticated = true;
      return { ok: true, version: welcome.protocolVersion };
    } catch (error) {
      if (error instanceof CoreRequestError && error.code === 'incompatible_protocol') {
        return { ok: false, error: 'incompatible_protocol' };
      }
      if (error instanceof CoreRequestError && error.code === 'authentication_failed') {
        return { ok: false, error: 'authentication_failed' };
      }
      throw error;
    }
  }

  #request(method: string, payload: unknown): Promise<unknown> {
    if (this.#closed || this.#socket.destroyed) {
      return Promise.reject(new Error('Core connection is closed'));
    }
    const id = randomUUID();
    const envelope: RequestEnvelope = {
      kind: 'request',
      id,
      protocolVersion: this.#options.protocolVersion,
      sentAt: new Date().toISOString(),
      method,
      payload: payload as never,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new CoreRequestError({
            code: 'request_cancelled',
            message: `Core request timed out: ${method}`,
            retryable: true,
          }),
        );
      }, this.#options.requestTimeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#socket.write(encodeControlFrame(envelope), (error) => {
        if (error === null || error === undefined) return;
        const pending = this.#pending.get(id);
        if (pending === undefined) return;
        this.#pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(error);
      });
    });
  }

  #finishDisconnect(error: unknown): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#authenticated = false;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    for (const listener of this.#disconnectListeners) listener();
    this.#disconnectListeners.clear();
    this.#eventListeners.clear();
    this.#terminalListeners.clear();
  }
}
