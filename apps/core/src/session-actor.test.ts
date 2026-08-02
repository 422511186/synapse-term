import { describe, expect, it } from 'vitest';

import { FakePty } from '@terminal-agent/test-kit';

import { SessionActor } from './session-actor.js';

describe('SessionActor', () => {
  it('invalidates shell capability when the execution dialect changes', async () => {
    const actor = new SessionActor('session-1', new FakePty(123), {
      executionDialect: 'posix',
    });
    await actor.markPtyRunning();
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');

    await actor.setExecutionDialect('powershell');

    expect(actor.snapshot).toMatchObject({
      executionDialect: 'powershell',
      shell: 'unknown',
      shellCapabilityEpoch: 2,
    });
  });

  it('serializes lease acquisition before the following agent write', async () => {
    const pty = new FakePty(123);
    const actor = new SessionActor('session-1', pty);
    await actor.markPtyRunning();

    const lease = actor.grantAgentLease('task-1', 0);
    const write = actor.writeAgent({
      taskId: 'task-1',
      leaseEpoch: 1,
      data: 'whoami\r',
    });

    await expect(lease).resolves.toMatchObject({ ok: true });
    await expect(write).resolves.toEqual({ ok: true });
    expect(pty.writes).toEqual(['whoami\r']);
    expect(actor.snapshot.lease).toEqual({
      owner: { kind: 'agent', taskId: 'task-1' },
      epoch: 1,
    });
  });

  it('invalidates stale agent input when the user takes over', async () => {
    const pty = new FakePty(123);
    const actor = new SessionActor('session-1', pty);
    await actor.markPtyRunning();
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    await actor.grantAgentLease('task-1', 0);

    const userWrite = actor.writeUser('manual input\r');
    const staleAgentWrite = actor.writeAgent({
      taskId: 'task-1',
      leaseEpoch: 1,
      data: 'agent input\r',
    });

    await expect(userWrite).resolves.toEqual({ ok: true });
    await expect(staleAgentWrite).resolves.toEqual({
      ok: false,
      error: 'stale-lease-epoch',
    });
    expect(pty.writes).toEqual(['manual input\r']);
    expect(actor.snapshot).toMatchObject({
      shell: 'unknown',
      shellCapabilityEpoch: 2,
      lease: { owner: { kind: 'user' }, epoch: 2 },
    });
  });

  it('supports explicit takeover and interrupt without treating them as agent writes', async () => {
    const pty = new FakePty(123);
    const actor = new SessionActor('session-1', pty);
    await actor.markPtyRunning();
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    const lease = await actor.grantAgentLease('task-1', 0);
    if (!lease.ok) throw new Error('expected lease');

    await actor.takeoverUser();
    expect(actor.snapshot).toMatchObject({
      shell: 'unknown',
      lease: { owner: { kind: 'user' }, epoch: 2 },
    });
    await actor.interrupt();
    expect(pty.interruptCount).toBe(1);
  });

  it('serializes PTY exit events without collapsing other state dimensions', async () => {
    const pty = new FakePty(123);
    const actor = new SessionActor('session-1', pty);
    const events: Array<{ type: string }> = [];
    const outputs: Array<{ sequence: number; data: string }> = [];
    actor.onEvent((event) => {
      events.push({ type: event.type });
      if (event.type === 'pty_output') outputs.push({ sequence: event.sequence, data: event.data });
    });
    await actor.markPtyRunning();

    pty.emitData('first');
    pty.emitData('second');
    pty.emitExit({ exitCode: 0 });
    await actor.idle();

    expect(actor.snapshot).toMatchObject({
      pty: 'exited',
      attachment: 'detached',
      lease: { owner: { kind: 'user' }, epoch: 0 },
    });
    expect(events.map((event) => event.type)).toEqual(['pty_output', 'pty_output', 'pty_exit']);
    expect(outputs).toEqual([
      { sequence: 1, data: 'first' },
      { sequence: 2, data: 'second' },
    ]);
  });

  it('parses split OSC 777 control frames without removing raw PTY output', async () => {
    const pty = new FakePty(123);
    const actor = new SessionActor('session-1', pty);
    const events: Array<{ type: string; data?: string; payload?: string }> = [];
    actor.onEvent((event) => {
      events.push(
        event.type === 'pty_output'
          ? { type: event.type, data: event.data }
          : event.type === 'osc_777'
            ? { type: event.type, payload: event.payload }
            : { type: event.type },
      );
    });
    await actor.markPtyRunning();

    pty.emitData('before\u001b]777;TA;nonce');
    pty.emitData('-1;0\u0007after');
    await actor.idle();

    expect(events).toEqual([
      { type: 'pty_output', data: 'before' },
      { type: 'osc_777', payload: 'TA;nonce-1;0' },
      { type: 'pty_output', data: 'after' },
    ]);
  });

  it('emits OSC 777 controls in order between surrounding output segments', async () => {
    const pty = new FakePty(123);
    const actor = new SessionActor('session-1', pty);
    const events: Array<{ type: string; data?: string; payload?: string }> = [];
    actor.onEvent((event) => {
      events.push(
        event.type === 'pty_output'
          ? { type: event.type, data: event.data }
          : event.type === 'osc_777'
            ? { type: event.type, payload: event.payload }
            : { type: event.type },
      );
    });
    await actor.markPtyRunning();

    pty.emitData('wrapper\u001b]777;TA_START\u0007actual output');
    await actor.idle();

    expect(events).toEqual([
      { type: 'pty_output', data: 'wrapper' },
      { type: 'osc_777', payload: 'TA_START' },
      { type: 'pty_output', data: 'actual output' },
    ]);
  });

  it('emits the printable start marker in order without exposing it as terminal output', async () => {
    const pty = new FakePty(123);
    const actor = new SessionActor('session-1', pty);
    const events: Array<{ type: string; data?: string; payload?: string }> = [];
    actor.onEvent((event) => {
      events.push(
        event.type === 'pty_output'
          ? { type: event.type, data: event.data }
          : event.type === 'osc_777'
            ? { type: event.type, payload: event.payload }
            : { type: event.type },
      );
    });
    await actor.markPtyRunning();

    pty.emitData('wrapper__TA_START__actual output');
    await actor.idle();

    expect(events).toEqual([
      { type: 'pty_output', data: 'wrapper' },
      { type: 'osc_777', payload: 'TA_START' },
      { type: 'pty_output', data: 'actual output' },
    ]);
    expect(actor.terminalSnapshot()).not.toContain('__TA_START__');
  });

  it('turns a printable completion marker into a control event and hides it from the terminal model', async () => {
    const pty = new FakePty(123);
    const actor = new SessionActor('session-1', pty);
    const controls: string[] = [];
    const outputs: Array<{ sequence: number; data: string }> = [];
    actor.onEvent((event) => {
      if (event.type === 'osc_777') controls.push(event.payload);
      if (event.type === 'pty_output') outputs.push({ sequence: event.sequence, data: event.data });
    });
    await actor.markPtyRunning();

    pty.emitData('visible __TA_DONE_nonce-1;0__ text\r\n');
    await actor.idle();

    expect(controls).toEqual(['TA;nonce-1;0']);
    expect(outputs.map((output) => output.data).join('')).toBe('visible  text\r\n');
    expect(actor.terminalSnapshot()).not.toContain('__TA_DONE_');
    expect(actor.terminalSnapshot()).toContain('visible  text');
  });

  it('resizes both the native PTY and the headless terminal model', async () => {
    const pty = new FakePty(123);
    const actor = new SessionActor('session-1', pty, { columns: 80, rows: 24 });
    await actor.markPtyRunning();

    await actor.resize(120, 40);

    expect(pty.resizes).toEqual([{ columns: 120, rows: 40 }]);
    expect(actor.terminalSnapshot()).toBeDefined();
  });

  it('waits for the native PTY exit during an explicit shutdown', async () => {
    const pty = new FakePty(123);
    const actor = new SessionActor('session-1', pty);
    await actor.markPtyRunning();

    const waiting = actor.waitForExit(1_000);
    await Promise.resolve();
    let resolved = false;
    void waiting.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    await actor.terminate();
    pty.emitExit({ exitCode: 0 });
    await waiting;
    expect(resolved).toBe(true);
  });

  it('detaches and reattaches UI without stopping PTY, and can mark restart interruption', async () => {
    const pty = new FakePty(123);
    const actor = new SessionActor('session-1', pty);
    await actor.markPtyRunning();
    await actor.attachUi();
    await actor.detachUi();
    expect(actor.snapshot).toMatchObject({ pty: 'running', attachment: 'detached' });

    await actor.markInterrupted();
    expect(actor.snapshot.pty).toBe('interrupted');
    await actor.terminate();
    expect(pty.terminateCount).toBe(1);
  });

  it('disposes PTY subscriptions and event listeners', async () => {
    const pty = new FakePty(123);
    const actor = new SessionActor('session-1', pty);
    const events: string[] = [];
    actor.onEvent((event) => events.push(event.type));
    actor.dispose();
    pty.emitData('ignored');
    await actor.idle();
    expect(events).toEqual([]);
  });
});
