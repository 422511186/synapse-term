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
    expect(await api.app.status()).toMatchObject({ connected: true, sessions: 1 });
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

  it('round-trips the general probe visibility setting through the restricted API', async () => {
    const api = createMockDesktopApi();

    const defaults = await api.general.getSettings();
    expect(defaults.hideCompletionProbeEcho).toBe(true);
    expect(defaults.themeMode).toBe('system');
    expect(defaults.customTheme.enabled).toBe(false);

    const updated = await api.general.updateSettings({
      hideCompletionProbeEcho: false,
      themeMode: 'light',
      customTheme: {
        enabled: true,
        background: '#101418',
        foreground: '#e8eef2',
        accent: '#3b82f6',
      },
    });
    expect(updated).toMatchObject({
      hideCompletionProbeEcho: false,
      themeMode: 'light',
      customTheme: { enabled: true, background: '#101418' },
    });
  });

  it('exposes theme state and notifies listeners on theme changes', async () => {
    const api = createMockDesktopApi();
    const received: Array<{ mode: string }> = [];
    api.theme.onChanged((state) => received.push({ mode: state.mode }));

    await expect(api.theme.getState()).resolves.toMatchObject({ mode: 'system', scheme: 'dark' });
    await api.general.updateSettings({ themeMode: 'dark' });
    expect(received.map((item) => item.mode)).toEqual(['dark']);
  });
});
