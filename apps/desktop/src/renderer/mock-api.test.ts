import { describe, expect, it } from 'vitest';

import { createMockDesktopApi } from './mock-api.js';

describe('mock desktop API', () => {
  it('creates sessions and emits terminal output', async () => {
    const api = createMockDesktopApi();
    const outputs: unknown[] = [];
    api.terminal.onOutput((event) => outputs.push(event));
    const session = await api.sessions.create({
      title: '终端 1',
      terminalType: 'Zsh',
      executable: '/bin/zsh',
      args: ['-l', '-i'],
      cwd: '/home/mock',
      env: {},
    });
    expect(session.pty).toBe('running');
    expect(outputs).toHaveLength(1);
    expect(await api.core.status()).toMatchObject({ connected: true, sessions: 1 });
  });

  it('renames and closes sessions', async () => {
    const api = createMockDesktopApi();
    const session = await api.sessions.create({
      title: 't',
      terminalType: 'Zsh',
      executable: '/bin/zsh',
      args: [],
      cwd: '/',
      env: {},
    });
    const renamed = await api.sessions.rename(session.id, '工作终端');
    expect(renamed.title).toBe('工作终端');
    expect(await api.sessions.close(session.id)).toBe(true);
    expect(await api.sessions.list()).toEqual([]);
  });
});
