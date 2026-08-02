import { describe, expect, it } from 'vitest';

import { FakePty } from '@synapse-term/test-kit';

import { SessionManager } from './session-manager.js';
import type { PtySpawnOptions, PtySpawner } from '../shell/pty-adapter.js';

class FakeSpawner implements PtySpawner {
  readonly spawned: PtySpawnOptions[] = [];
  readonly ptys: FakePty[] = [];

  spawn(options: PtySpawnOptions) {
    this.spawned.push(options);
    const pty = new FakePty(this.spawned.length);
    this.ptys.push(pty);
    return pty;
  }
}

const config = (id: string): { id: string; launch: PtySpawnOptions } => ({
  id,
  launch: {
    executable: 'bash.exe',
    args: [],
    cwd: 'C:/work',
    env: { TERM: 'xterm-256color' },
    columns: 80,
    rows: 24,
  },
});

describe('SessionManager', () => {
  it('creates sessions with a configurable hard limit', async () => {
    const spawner = new FakeSpawner();
    const manager = new SessionManager(spawner, { maxSessions: 1 });

    const actor = await manager.create(config('session-1'));
    expect(actor.snapshot).toMatchObject({ id: 'session-1', pty: 'running' });
    await expect(manager.create(config('session-2'))).rejects.toMatchObject({
      code: 'session_limit_reached',
    });
    expect(manager.activeCount).toBe(1);
    spawner.ptys[0]!.emitExit({ exitCode: 0 });
    await actor.idle();
    expect(manager.activeCount).toBe(0);
  });

  it('explicitly terminates and removes a session', async () => {
    const spawner = new FakeSpawner();
    const manager = new SessionManager(spawner, { maxSessions: 2 });
    await manager.create(config('session-1'));

    await expect(manager.close('session-1')).resolves.toBe(true);
    expect(spawner.ptys[0]!.terminateCount).toBe(1);
    expect(manager.activeCount).toBe(0);
    await expect(manager.close('missing')).resolves.toBe(false);
  });

  it('initializes the Session execution dialect without probing the PTY', async () => {
    const spawner = new FakeSpawner();
    const manager = new SessionManager(spawner);
    const actor = await manager.create({
      ...config('session-powershell'),
      executionDialect: 'powershell',
    });

    expect(actor.snapshot.executionDialect).toBe('powershell');
    expect(spawner.ptys[0]?.writes).toEqual([]);
  });
});
