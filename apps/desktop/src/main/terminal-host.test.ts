import { describe, expect, it, vi } from 'vitest';

import { createFakeTerminalBackend } from '@synapse-term/test-kit';
import type { LocalShellDescriptor, PtySpawner } from '@synapse-term/terminal-service';

import type { TerminalOutputEvent } from '../shared/contracts.js';
import { TerminalHost } from './terminal-host.js';

class FakePtySpawner implements PtySpawner {
  readonly spawned: ReturnType<typeof createFakeTerminalBackend>[] = [];

  spawn() {
    const backend = createFakeTerminalBackend();
    this.spawned.push(backend);
    return backend;
  }
}

const shells: LocalShellDescriptor[] = [
  {
    kind: 'zsh',
    label: 'Zsh',
    available: true,
    source: 'system',
    args: ['-l', '-i'],
    executable: '/bin/zsh',
  },
];

function createHost(spawner: FakePtySpawner): TerminalHost {
  return new TerminalHost({
    spawner,
    home: '/home/test',
    shellLocator: { list: () => shells } as never,
    version: 'test',
  });
}

describe('TerminalHost', () => {
  it('creates, writes, renames and closes a session', async () => {
    const spawner = new FakePtySpawner();
    const host = createHost(spawner);
    const created = await host.createSession({
      title: '终端 1',
      terminalType: 'Zsh',
      executable: '/bin/zsh',
      args: ['-l', '-i'],
      cwd: '/home/test',
      env: {},
    });
    expect(created).toMatchObject({ title: '终端 1', pty: 'running' });
    expect(host.listSessions()).toHaveLength(1);

    await host.write(created.id, 'ls\r');
    expect(spawner.spawned[0]?.writes).toEqual(['ls\r']);

    const renamed = await host.renameSession(created.id, '工作终端');
    expect(renamed.title).toBe('工作终端');

    expect(await host.closeSession(created.id)).toBe(true);
    expect(host.listSessions()).toHaveLength(0);
  });

  it('streams ordered output and reports status', async () => {
    const spawner = new FakePtySpawner();
    const host = createHost(spawner);
    const received: TerminalOutputEvent[] = [];
    host.onTerminalOutput((event) => received.push(event));
    await host.createSession({
      title: 't',
      terminalType: 'Zsh',
      executable: '/bin/zsh',
      args: [],
      cwd: '/',
      env: {},
    });
    const backend = spawner.spawned[0];
    expect(backend).toBeDefined();
    backend?.emitData('hello');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received.map((event) => event.data)).toEqual(['hello']);
    expect(host.status()).toMatchObject({ connected: true, version: 'test', sessions: 1 });
    await host.shutdown();
  });

  it('applies probe echo visibility to the local UI output without changing the Session actor', async () => {
    const spawner = new FakePtySpawner();
    const host = createHost(spawner);
    const received: TerminalOutputEvent[] = [];
    host.onTerminalOutput((event) => received.push(event));
    const created = await host.createSession({
      title: 't',
      terminalType: 'PowerShell',
      executable: 'pwsh',
      args: [],
      cwd: '/',
      env: {},
    });
    const actor = host.getMcpSessionSource().get(created.id);
    expect(actor).toBeDefined();
    await actor?.setProbeEchoVisibility(false);
    actor?.suppressInputEcho({ start: '[probe:', end: ':end]' });

    spawner.spawned[0]?.emitData('before [probe:diagnostic:end]after');
    await vi.waitFor(() =>
      expect(received.map((event) => event.data).join('')).toBe(
        'before [probe:diagnostic:end]after',
      ),
    );
    await host.shutdown();
  });

  it('throws for unknown channels', async () => {
    const host = createHost(new FakePtySpawner());
    await expect(host.handle('unknown:channel', [])).rejects.toThrow(/not available/);
  });

  it('rejects invalid or oversized launch input', async () => {
    const host = createHost(new FakePtySpawner());
    await expect(
      host.handle('sessions:create', [
        {
          title: 't',
          terminalType: 'Zsh',
          executable: '/bin/zsh',
          args: Array.from({ length: 300 }, () => 'a'),
          cwd: '/',
          env: {},
        },
      ]),
    ).rejects.toThrow();
  });
});
