import { describe, expect, it } from 'vitest';

import { createFakeTerminalBackend } from '@synapse-term/test-kit';

import type { PtySpawner } from '../shell/pty-adapter.js';
import { SessionManager, SessionResourceError } from './session-manager.js';

class FakePtySpawner implements PtySpawner {
  readonly spawned: ReturnType<typeof createFakeTerminalBackend>[] = [];

  spawn() {
    const backend = createFakeTerminalBackend();
    this.spawned.push(backend);
    return backend;
  }
}

describe('SessionManager', () => {
  it('creates, lists and closes sessions', async () => {
    const spawner = new FakePtySpawner();
    const manager = new SessionManager(spawner);
    const actor = await manager.create({
      id: 's1',
      title: '终端 1',
      terminalType: 'Zsh',
      launch: {
        executable: '/bin/zsh',
        args: ['-l', '-i'],
        cwd: '/Users/test',
        env: {},
        columns: 80,
        rows: 24,
      },
    });
    expect(manager.activeCount).toBe(1);
    expect(actor.snapshot.pty).toBe('running');
    expect(await manager.close('s1')).toBe(true);
    expect(manager.activeCount).toBe(0);
  });

  it('enforces session limit and duplicate ids', async () => {
    const manager = new SessionManager(new FakePtySpawner(), { maxSessions: 1 });
    await manager.create({
      id: 's1',
      title: 't',
      terminalType: 'Zsh',
      launch: {
        executable: '/bin/zsh',
        args: [],
        cwd: '/',
        env: {},
        columns: 80,
        rows: 24,
      },
    });
    await expect(
      manager.create({
        id: 's2',
        title: 't',
        terminalType: 'Zsh',
        launch: {
          executable: '/bin/zsh',
          args: [],
          cwd: '/',
          env: {},
          columns: 80,
          rows: 24,
        },
      }),
    ).rejects.toBeInstanceOf(SessionResourceError);
  });

  it('keeps sessions visible after the pty exits', async () => {
    const spawner = new FakePtySpawner();
    const manager = new SessionManager(spawner);
    await manager.create({
      id: 's1',
      title: 't',
      terminalType: 'Zsh',
      launch: {
        executable: '/bin/zsh',
        args: [],
        cwd: '/',
        env: {},
        columns: 80,
        rows: 24,
      },
    });
    spawner.spawned[0]?.emitExit(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(manager.activeCount).toBe(1);
    expect(manager.get('s1')?.snapshot.pty).toBe('exited');
  });
});
