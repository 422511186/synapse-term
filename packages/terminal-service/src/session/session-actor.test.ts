import { describe, expect, it } from 'vitest';

import { createFakeTerminalBackend } from '@synapse-term/test-kit';

import { SessionActor } from './session-actor.js';

describe('SessionActor', () => {
  it('serializes pty output into ordered events', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, {
      title: '终端 1',
      terminalType: 'Zsh',
    });
    const events: Array<{ sequence: number; data: string }> = [];
    actor.onEvent((event) => {
      if (event.type === 'pty_output') events.push({ sequence: event.sequence, data: event.data });
    });
    await actor.markPtyRunning();
    backend.emitData('hello');
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual([{ sequence: 1, data: 'hello' }]);
    actor.dispose();
  });

  it('forwards user input and resize to the backend', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, {
      title: 't',
      terminalType: 'Zsh',
      columns: 80,
      rows: 24,
    });
    await actor.markPtyRunning();
    await actor.writeUser('ls\r');
    await actor.resize(120, 40);
    expect(backend.writes).toEqual(['ls\r']);
    expect(backend.resizes).toEqual([{ columns: 120, rows: 40 }]);
    expect(actor.snapshot).toMatchObject({ columns: 120, rows: 40 });
    actor.dispose();
  });

  it('rejects user input after exit', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, { title: 't', terminalType: 'Zsh' });
    await actor.markPtyRunning();
    backend.emitExit(0);
    await Promise.resolve();
    const result = await actor.writeUser('x');
    expect(result).toEqual({ ok: false, error: 'session-not-running' });
    expect(actor.snapshot.pty).toBe('exited');
    actor.dispose();
  });

  it('resolves waitForExit when the backend exits', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, { title: 't', terminalType: 'Zsh' });
    const wait = actor.waitForExit(1_000);
    backend.emitExit(0);
    await expect(wait).resolves.toBeUndefined();
    actor.dispose();
  });
});
