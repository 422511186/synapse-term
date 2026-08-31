import { describe, expect, it } from 'vitest';

import { createDesktopApi, type RendererIpc } from './preload-api.js';

describe('preload desktop API', () => {
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
});
