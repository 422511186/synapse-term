import {
  negotiateProtocolVersion,
  type EventEnvelope,
  type ProtocolVersion,
} from '@synapse-term/protocol';

export interface CoreTerminalOutput {
  sessionId: string;
  sequence: number;
  data: string;
}

export interface CoreHandshakeResult {
  ok: true;
  version: ProtocolVersion;
}

export interface CoreHandshakeFailure {
  ok: false;
  error: 'incompatible_protocol' | 'authentication_failed';
}

export interface CoreConnection {
  handshake(): Promise<CoreHandshakeResult | CoreHandshakeFailure>;
  request<T>(method: string, payload: unknown): Promise<T>;
  onEvent(listener: (event: EventEnvelope) => void): () => void;
  onTerminalOutput(listener: (event: CoreTerminalOutput) => void): () => void;
  onDisconnect(listener: () => void): () => void;
  close(): Promise<void>;
}

export interface CoreConnector {
  connect(): Promise<CoreConnection>;
}

export interface CoreProcessLauncher {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface CoreSupervisorOptions {
  protocolVersion: ProtocolVersion;
  connector: CoreConnector;
  launcher: CoreProcessLauncher;
  maxConnectAttempts?: number;
  connectRetryDelayMs?: number;
}

export type CoreSupervisorState =
  | 'disconnected'
  | 'starting'
  | 'connected'
  | 'detached'
  | 'version_conflict'
  | 'authentication_failed'
  | 'closed';

type CoreConnectResult =
  | { ok: true; state: 'connected' }
  | { ok: false; state: 'version_conflict'; error: 'incompatible_protocol' }
  | { ok: false; state: 'authentication_failed'; error: 'authentication_failed' };

const READ_ONLY_REQUESTS = new Set([
  'core.status',
  'session.list',
  'terminal.replay',
  'resources.get',
  'agent.history',
  'provider.list',
  'model.list',
  'audit.list',
]);
const TRANSPORT_FAILURE_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'request_cancelled',
]);

export class CoreSupervisor {
  readonly #options: CoreSupervisorOptions;
  readonly #maxConnectAttempts: number;
  readonly #connectRetryDelayMs: number;
  #state: CoreSupervisorState = 'disconnected';
  #connection: CoreConnection | undefined;
  #connectPromise: Promise<CoreConnectResult> | undefined;
  #removeDisconnectListener: (() => void) | undefined;
  readonly #eventListeners = new Set<(event: EventEnvelope) => void>();
  readonly #terminalListeners = new Set<(event: CoreTerminalOutput) => void>();
  readonly #eventRemovers = new Map<(event: EventEnvelope) => void, () => void>();
  readonly #terminalRemovers = new Map<(event: CoreTerminalOutput) => void, () => void>();

  constructor(options: CoreSupervisorOptions) {
    this.#options = options;
    this.#maxConnectAttempts = options.maxConnectAttempts ?? 50;
    this.#connectRetryDelayMs = options.connectRetryDelayMs ?? 200;
    if (!Number.isInteger(this.#maxConnectAttempts) || this.#maxConnectAttempts < 1) {
      throw new RangeError('maxConnectAttempts must be a positive integer');
    }
    if (!Number.isFinite(this.#connectRetryDelayMs) || this.#connectRetryDelayMs < 0) {
      throw new RangeError('connectRetryDelayMs must be non-negative');
    }
  }

  get state(): CoreSupervisorState {
    return this.#state;
  }

  connect(): Promise<CoreConnectResult> {
    if (this.#state === 'connected') {
      return Promise.resolve({ ok: true as const, state: 'connected' as const });
    }
    if (this.#state === 'closed') return Promise.reject(new Error('CoreSupervisor is closed'));

    if (this.#connectPromise !== undefined) return this.#connectPromise;

    const attempt = this.#connectInternal();
    const tracked = attempt.finally(() => {
      if (this.#connectPromise === tracked) this.#connectPromise = undefined;
    });
    this.#connectPromise = tracked;
    return tracked;
  }

  async #connectInternal(): Promise<CoreConnectResult> {
    this.#state = 'starting';
    let connection: CoreConnection;
    try {
      connection = await this.#options.connector.connect();
    } catch {
      await this.#options.launcher.start();
      try {
        connection = await this.#connectWithRetries();
      } catch (error) {
        this.#state = 'disconnected';
        throw error;
      }
    }

    const handshake = await connection.handshake();
    if (!handshake.ok) {
      await connection.close();
      if (handshake.error === 'authentication_failed') {
        this.#state = 'authentication_failed';
        return { ok: false, state: 'authentication_failed', error: 'authentication_failed' };
      }
      this.#state = 'version_conflict';
      return { ok: false, state: 'version_conflict', error: 'incompatible_protocol' };
    }
    const negotiated = negotiateProtocolVersion(this.#options.protocolVersion, handshake.version);
    if (!negotiated.ok) {
      await connection.close();
      this.#state = 'version_conflict';
      return { ok: false, state: 'version_conflict', error: 'incompatible_protocol' };
    }

    this.#connection = connection;
    this.#removeDisconnectListener = connection.onDisconnect(() =>
      this.#handleDisconnect(connection),
    );
    this.#bindListeners(connection);
    this.#state = 'connected';
    return { ok: true, state: 'connected' };
  }

  async #connectWithRetries(): Promise<CoreConnection> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.#maxConnectAttempts; attempt += 1) {
      try {
        return await this.#options.connector.connect();
      } catch (error) {
        lastError = error;
        if (attempt + 1 < this.#maxConnectAttempts && this.#connectRetryDelayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, this.#connectRetryDelayMs));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Core connection failed');
  }

  async request<T>(method: string, payload: unknown): Promise<T> {
    let retried = false;
    while (true) {
      let connection = this.#connection;
      if (connection === undefined) {
        let result: CoreConnectResult;
        try {
          result = await this.connect();
        } catch (error) {
          if (retried || !isTransportFailure(error)) throw error;
          retried = true;
          continue;
        }
        if (!result.ok) {
          throw new Error(
            result.error === 'authentication_failed'
              ? 'Core authentication failed'
              : 'Core protocol version is incompatible',
          );
        }
        connection = this.#connection;
      }
      if (connection === undefined) throw new Error('Core is not connected');

      try {
        return await connection.request<T>(method, payload);
      } catch (error) {
        if (retried || !isRetryableReadRequest(method, error)) throw error;
        retried = true;
        if (this.#connection === connection) {
          await this.#closeConnection();
          this.#state = 'disconnected';
        }
      }
    }
  }

  onEvent(listener: (event: EventEnvelope) => void): () => void {
    this.#eventListeners.add(listener);
    if (this.#connection !== undefined) {
      this.#eventRemovers.set(listener, this.#connection.onEvent(listener));
    }
    return () => {
      this.#eventRemovers.get(listener)?.();
      this.#eventRemovers.delete(listener);
      this.#eventListeners.delete(listener);
    };
  }

  onTerminalOutput(listener: (event: CoreTerminalOutput) => void): () => void {
    this.#terminalListeners.add(listener);
    if (this.#connection !== undefined) {
      this.#terminalRemovers.set(listener, this.#connection.onTerminalOutput(listener));
    }
    return () => {
      this.#terminalRemovers.get(listener)?.();
      this.#terminalRemovers.delete(listener);
      this.#terminalListeners.delete(listener);
    };
  }

  async requestExit(
    choice: 'keep_background' | 'terminate_all',
  ): Promise<{ ok: true; state: 'detached' } | { ok: true; state: 'closed' }> {
    if (choice === 'keep_background') {
      await this.#closeConnection();
      this.#state = 'detached';
      return { ok: true, state: 'detached' };
    }

    if (this.#connection !== undefined) {
      await this.#connection.request('core.shutdown', { mode: 'terminate_all' });
    }
    await this.#closeConnection();
    await this.#options.launcher.stop();
    this.#state = 'closed';
    return { ok: true, state: 'closed' };
  }

  async #closeConnection(): Promise<void> {
    const connection = this.#connection;
    this.#connection = undefined;
    this.#unbindListeners();
    this.#removeDisconnectListener?.();
    this.#removeDisconnectListener = undefined;
    if (connection !== undefined) await connection.close();
  }

  #bindListeners(connection: CoreConnection): void {
    for (const listener of this.#eventListeners) {
      this.#eventRemovers.set(listener, connection.onEvent(listener));
    }
    for (const listener of this.#terminalListeners) {
      this.#terminalRemovers.set(listener, connection.onTerminalOutput(listener));
    }
  }

  #unbindListeners(): void {
    for (const remove of this.#eventRemovers.values()) remove();
    for (const remove of this.#terminalRemovers.values()) remove();
    this.#eventRemovers.clear();
    this.#terminalRemovers.clear();
  }

  #handleDisconnect(connection: CoreConnection): void {
    if (this.#connection !== connection) return;
    this.#connection = undefined;
    this.#unbindListeners();
    this.#removeDisconnectListener = undefined;
    if (this.#state !== 'closed') this.#state = 'disconnected';
  }
}

function isRetryableReadRequest(method: string, error: unknown): boolean {
  return READ_ONLY_REQUESTS.has(method) && isTransportFailure(error);
}

function isTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code === 'string' && TRANSPORT_FAILURE_CODES.has(code)) return true;
  return /core connection (?:is )?closed|socket hang up|write after end/i.test(error.message);
}
