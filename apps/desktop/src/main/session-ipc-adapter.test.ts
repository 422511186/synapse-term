import { describe, expect, it } from 'vitest';

import { createFakeTerminalBackend } from '@synapse-term/test-kit';
import { SessionRuntime, type SessionRuntimeOptions } from '@synapse-term/session-runtime';

import { SessionIpcAdapter } from './session-ipc-adapter.js';

type PtySpawner = NonNullable<SessionRuntimeOptions['spawner']>;

class FakePtySpawner implements PtySpawner {
  spawn() {
    return createFakeTerminalBackend();
  }
}

function createAdapter(): SessionIpcAdapter {
  return new SessionIpcAdapter(
    new SessionRuntime({
      spawner: new FakePtySpawner(),
      home: '/home/test',
      shellLocator: { list: () => [] } as never,
      version: 'test',
    }),
  );
}

describe('SessionIpcAdapter', () => {
  it('rejects channels outside the Desktop session contract', async () => {
    await expect(createAdapter().handle('unknown:channel', [])).rejects.toThrow(/not available/);
  });

  it('validates launch input before asking the runtime to create a PTY', async () => {
    await expect(
      createAdapter().handle('sessions:create', [
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
