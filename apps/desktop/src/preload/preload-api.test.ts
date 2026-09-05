import { describe, expect, it } from 'vitest';

import { createDesktopApi, type RendererIpc } from './preload-api.js';

describe('preload desktop API', () => {
  it('passes update confirmation through only the declared update channel', async () => {
    const calls: unknown[] = [];
    const api = createDesktopApi({
      invoke: async (channel, ...args) => {
        calls.push({ channel, args });
      },
      on: () => () => undefined,
    });
    await api.updates.install('candidate-id', 'confirmation-id');
    expect(calls).toEqual([
      { channel: 'updates:install', args: ['candidate-id', 'confirmation-id'] },
    ]);
  });
  it('exposes general settings only through the restricted IPC channels', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    const ipc: RendererIpc = {
      invoke: async (channel, ...args) => {
        calls.push({ channel, args });
        return channel === 'settings:get-general'
          ? { hideCompletionProbeEcho: true }
          : { hideCompletionProbeEcho: false };
      },
      on: () => () => undefined,
    };
    const api = createDesktopApi(ipc);

    await expect(api.general.getSettings()).resolves.toEqual({ hideCompletionProbeEcho: true });
    await expect(api.general.updateSettings({ hideCompletionProbeEcho: false })).resolves.toEqual({
      hideCompletionProbeEcho: false,
    });
    expect(calls).toEqual([
      { channel: 'settings:get-general', args: [] },
      { channel: 'settings:update-general', args: [{ hideCompletionProbeEcho: false }] },
    ]);
  });

  it('reads theme state over the restricted theme channel and subscribes to changes', async () => {
    const state = {
      mode: 'system',
      scheme: 'dark',
      customTheme: {
        enabled: false,
        background: '#09090b',
        foreground: '#fafafa',
        accent: '#fafafa',
      },
    };
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    let listener: ((payload: unknown) => void) | undefined;
    const ipc: RendererIpc = {
      invoke: async (channel, ...args) => {
        calls.push({ channel, args });
        return state;
      },
      on: (channel, handler) => {
        if (channel === 'theme:changed') listener = handler;
        return () => undefined;
      },
    };
    const api = createDesktopApi(ipc);

    await expect(api.theme.getState()).resolves.toEqual(state);
    let received: unknown;
    api.theme.onChanged((next) => {
      received = next;
    });
    listener?.({ ...state, scheme: 'light' });
    expect(received).toEqual({ ...state, scheme: 'light' });
    expect(calls).toEqual([{ channel: 'theme:get-state', args: [] }]);
  });
});
