import { describe, expect, it } from 'vitest';

import { UpdateController } from './update-controller.js';
import { handleUpdateRequest } from './update-ipc-adapter.js';

describe('restricted update IPC', () => {
  it('rejects malformed identifiers, preferences and extra arguments before any side effect', async () => {
    const effects: string[] = [];
    const controller = new UpdateController({
      currentVersion: '0.5.1',
      automaticChecks: false,
      adapter: {
        check: async () => {
          effects.push('check');
          return null;
        },
        download: async () => {
          effects.push('download');
        },
        prepare: async () => {
          effects.push('prepare');
        },
        install: async () => {
          effects.push('install');
        },
        dispose: async () => undefined,
      },
      saveAutomaticChecks: async () => {
        effects.push('preference');
      },
      getSessionIds: () => [],
      shutdownForInstall: async () => {
        effects.push('shutdown');
      },
    });
    try {
      const invalid: [string, unknown[]][] = [
        ['updates:set-automatic-checks', ['true']],
        ['updates:download', [{ url: 'https://example.org/installer.exe' }]],
        ['updates:download', ['../../installer.exe']],
        ['updates:install-impact', [null]],
        ['updates:install', ['candidate', 123]],
        ['updates:install', ['candidate', 'confirmation', '/S']],
        ['updates:check', ['https://example.org/feed']],
        ['updates:cancel', ['candidate']],
        ['updates:unknown', []],
      ];
      for (const [channel, args] of invalid) {
        await expect(
          async () => await handleUpdateRequest(controller, channel, args),
        ).rejects.toThrow();
      }
      expect(effects).toEqual([]);
    } finally {
      await controller.dispose();
    }
  });
});
