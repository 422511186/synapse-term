import { describe, expect, it } from 'vitest';

import { CURRENT_PROTOCOL_VERSION } from '@terminal-agent/protocol';
import type { EventEnvelope } from '@terminal-agent/protocol';

import {
  CoreSupervisor,
  type CoreConnection,
  type CoreConnector,
  type CoreHandshakeFailure,
  type CoreHandshakeResult,
  type CoreProcessLauncher,
} from './core-supervisor.js';

class FakeConnection implements CoreConnection {
  readonly requests: Array<{ method: string; payload: unknown }> = [];
  readonly eventListeners = new Set<(event: EventEnvelope) => void>();
  readonly terminalListeners = new Set<
    (event: { sessionId: string; sequence: number; data: string }) => void
  >();
  requestError: Error | undefined;
  #disconnectListener: (() => void) | undefined;

  constructor(
    private readonly handshakeResult: CoreHandshakeResult | CoreHandshakeFailure = {
      ok: true as const,
      version: CURRENT_PROTOCOL_VERSION,
    },
  ) {}

  async handshake() {
    return this.handshakeResult;
  }

  async request<T>(method: string, payload: unknown): Promise<T> {
    this.requests.push({ method, payload });
    const requestError = this.requestError;
    this.requestError = undefined;
    if (requestError !== undefined) {
      this.disconnect();
      throw requestError;
    }
    return { accepted: true } as T;
  }

  onEvent(_listener: (event: EventEnvelope) => void): () => void {
    this.eventListeners.add(_listener);
    return () => this.eventListeners.delete(_listener);
  }

  onTerminalOutput(
    _listener: (event: { sessionId: string; sequence: number; data: string }) => void,
  ): () => void {
    this.terminalListeners.add(_listener);
    return () => this.terminalListeners.delete(_listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.#disconnectListener = listener;
    return () => {
      this.#disconnectListener = undefined;
    };
  }

  async close(): Promise<void> {}

  disconnect(): void {
    this.#disconnectListener?.();
  }

  emitEvent(event: EventEnvelope): void {
    for (const listener of this.eventListeners) listener(event);
  }

  emitTerminal(event: { sessionId: string; sequence: number; data: string }): void {
    for (const listener of this.terminalListeners) listener(event);
  }
}

class FakeConnector implements CoreConnector {
  readonly connections: FakeConnection[] = [];
  connectCalls = 0;
  connectGate: Promise<void> | undefined;
  failuresRemaining = 0;
  failFirst = false;
  handshakeResult: CoreHandshakeResult | CoreHandshakeFailure = {
    ok: true,
    version: CURRENT_PROTOCOL_VERSION,
  };

  async connect(): Promise<CoreConnection> {
    this.connectCalls += 1;
    await this.connectGate;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw Object.assign(new Error('connect ECONNREFUSED /tmp/terminal-agent.sock'), {
        code: 'ECONNREFUSED',
      });
    }
    if (this.failFirst) {
      this.failFirst = false;
      throw new Error('core-not-running');
    }
    const connection = new FakeConnection(this.handshakeResult);
    this.connections.push(connection);
    return connection;
  }
}

class FakeLauncher implements CoreProcessLauncher {
  startCalls = 0;
  stopCalls = 0;

  async start(): Promise<void> {
    this.startCalls += 1;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
  }
}

describe('CoreSupervisor', () => {
  it('connects to an existing Core and keeps it in the background on UI exit', async () => {
    const connector = new FakeConnector();
    const launcher = new FakeLauncher();
    const supervisor = new CoreSupervisor({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      connector,
      launcher,
    });

    await expect(supervisor.connect()).resolves.toEqual({ ok: true, state: 'connected' });
    expect(launcher.startCalls).toBe(0);
    await expect(supervisor.requestExit('keep_background')).resolves.toEqual({
      ok: true,
      state: 'detached',
    });
    expect(launcher.stopCalls).toBe(0);
  });

  it('launches Core when discovery fails, then reconnects after a disconnect', async () => {
    const connector = new FakeConnector();
    connector.failFirst = true;
    const launcher = new FakeLauncher();
    const supervisor = new CoreSupervisor({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      connector,
      launcher,
    });

    await expect(supervisor.connect()).resolves.toEqual({ ok: true, state: 'connected' });
    expect(launcher.startCalls).toBe(1);
    connector.connections[0]?.disconnect();
    expect(supervisor.state).toBe('disconnected');
    await expect(supervisor.connect()).resolves.toEqual({ ok: true, state: 'connected' });
    expect(connector.connections).toHaveLength(2);
  });

  it('shares one in-flight connection attempt across concurrent callers', async () => {
    const connector = new FakeConnector();
    let release: () => void = () => undefined;
    connector.connectGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const supervisor = new CoreSupervisor({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      connector,
      launcher: new FakeLauncher(),
    });

    const first = supervisor.connect();
    const second = supervisor.connect();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const connectCallsBeforeRelease = connector.connectCalls;
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, state: 'connected' },
      { ok: true, state: 'connected' },
    ]);

    expect(connectCallsBeforeRelease).toBe(1);
    expect(connector.connections).toHaveLength(1);
  });

  it('reconnects and retries a read request after a transport disconnect', async () => {
    const connector = new FakeConnector();
    const supervisor = new CoreSupervisor({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      connector,
      launcher: new FakeLauncher(),
    });

    await supervisor.connect();
    connector.connections[0]!.requestError = Object.assign(
      new Error('connect ECONNREFUSED /tmp/terminal-agent.sock'),
      { code: 'ECONNREFUSED' },
    );

    await expect(supervisor.request('session.list', {})).resolves.toEqual({ accepted: true });
    expect(connector.connections).toHaveLength(2);
  });

  it('reconnects and retries a read request after a Core request timeout', async () => {
    const connector = new FakeConnector();
    const supervisor = new CoreSupervisor({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      connector,
      launcher: new FakeLauncher(),
    });

    await supervisor.connect();
    connector.connections[0]!.requestError = Object.assign(
      new Error('Core request timed out: agent.history'),
      { code: 'request_cancelled' },
    );

    await expect(supervisor.request('agent.history', { sessionId: 'session-1' })).resolves.toEqual({
      accepted: true,
    });
    expect(connector.connections).toHaveLength(2);
  });

  it('retries a read request when the initial Core startup attempt fails', async () => {
    const connector = new FakeConnector();
    connector.failuresRemaining = 2;
    const launcher = new FakeLauncher();
    const supervisor = new CoreSupervisor({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      connector,
      launcher,
      maxConnectAttempts: 1,
      connectRetryDelayMs: 0,
    });

    await expect(supervisor.request('session.list', {})).resolves.toEqual({ accepted: true });
    expect(launcher.startCalls).toBe(1);
    expect(connector.connections).toHaveLength(1);
  });

  it('surfaces a protocol version conflict without restarting the existing Core', async () => {
    const connector = new FakeConnector();
    connector.handshakeResult = { ok: false, error: 'incompatible_protocol' };
    const launcher = new FakeLauncher();
    const supervisor = new CoreSupervisor({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      connector,
      launcher,
    });

    await expect(supervisor.connect()).resolves.toEqual({
      ok: false,
      state: 'version_conflict',
      error: 'incompatible_protocol',
    });
    expect(launcher.startCalls).toBe(0);
    expect(supervisor.state).toBe('version_conflict');
  });

  it('surfaces authentication failure separately from protocol incompatibility', async () => {
    const connector = new FakeConnector();
    connector.handshakeResult = { ok: false, error: 'authentication_failed' };
    const supervisor = new CoreSupervisor({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      connector,
      launcher: new FakeLauncher(),
    });

    await expect(supervisor.connect()).resolves.toEqual({
      ok: false,
      state: 'authentication_failed',
      error: 'authentication_failed',
    });
    expect(supervisor.state).toBe('authentication_failed');
  });

  it('checks the negotiated version returned by the connection', async () => {
    const connector = new FakeConnector();
    connector.handshakeResult = { ok: true, version: { major: 3, minor: 0 } };
    const supervisor = new CoreSupervisor({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      connector,
      launcher: new FakeLauncher(),
    });

    await expect(supervisor.connect()).resolves.toEqual({
      ok: false,
      state: 'version_conflict',
      error: 'incompatible_protocol',
    });
  });

  it('requests Core termination before stopping the launcher', async () => {
    const connector = new FakeConnector();
    const launcher = new FakeLauncher();
    const supervisor = new CoreSupervisor({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      connector,
      launcher,
    });
    await supervisor.connect();

    await supervisor.requestExit('terminate_all');
    expect(connector.connections[0]?.requests).toContainEqual({
      method: 'core.shutdown',
      payload: { mode: 'terminate_all' },
    });
    expect(launcher.stopCalls).toBe(1);
  });

  it('forwards requests and reconnect-safe event subscriptions', async () => {
    const connector = new FakeConnector();
    const supervisor = new CoreSupervisor({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      connector,
      launcher: new FakeLauncher(),
    });
    const events: EventEnvelope[] = [];
    const outputs: Array<{ sessionId: string; sequence: number; data: string }> = [];
    supervisor.onEvent((event) => events.push(event));
    supervisor.onTerminalOutput((event) => outputs.push(event));

    await supervisor.connect();
    const first = connector.connections[0]!;
    await expect(supervisor.request('core.status', {})).resolves.toEqual({ accepted: true });
    first.emitEvent({
      kind: 'event',
      id: 'event-1',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      sentAt: '2026-07-27T00:00:00.000Z',
      streamId: 'core',
      sequence: 1,
      event: 'core.status',
      payload: {},
    });
    first.emitTerminal({ sessionId: 'session-1', sequence: 1, data: 'ok' });
    expect(events).toHaveLength(1);
    expect(outputs).toHaveLength(1);

    first.disconnect();
    await supervisor.connect();
    connector.connections[1]!.emitEvent({
      kind: 'event',
      id: 'event-2',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      sentAt: '2026-07-27T00:00:01.000Z',
      streamId: 'core',
      sequence: 2,
      event: 'core.status',
      payload: {},
    });
    expect(events).toHaveLength(2);
  });

  it('waits for a newly launched Core to bind its Pipe', async () => {
    const connector = new FakeConnector();
    let failures = 2;
    const originalConnect = connector.connect.bind(connector);
    connector.connect = async () => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('pipe-not-ready');
      }
      return originalConnect();
    };
    const supervisor = new CoreSupervisor({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      connector,
      launcher: new FakeLauncher(),
      connectRetryDelayMs: 0,
      maxConnectAttempts: 4,
    });

    await expect(supervisor.connect()).resolves.toEqual({ ok: true, state: 'connected' });
  });

  it('waits through a cold Core startup that exceeds the initial two-second window', async () => {
    const connector = new FakeConnector();
    let failures = 50;
    const originalConnect = connector.connect.bind(connector);
    connector.connect = async () => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('pipe-not-ready');
      }
      return originalConnect();
    };
    const launcher = new FakeLauncher();
    const supervisor = new CoreSupervisor({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      connector,
      launcher,
      connectRetryDelayMs: 0,
    });

    await expect(supervisor.connect()).resolves.toEqual({ ok: true, state: 'connected' });
    expect(launcher.startCalls).toBe(1);
  });
});
