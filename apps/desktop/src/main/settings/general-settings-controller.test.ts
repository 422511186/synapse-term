import { describe, expect, it } from 'vitest';

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GeneralSettingsController } from './general-settings-controller.js';

describe('GeneralSettingsController', () => {
  it('applies the default and persisted preference through Main', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'synapse-term-general-controller-'));
    const applied: boolean[] = [];
    const controller = new GeneralSettingsController({
      settingsStoreDirectory: directory,
      apply: async (settings) => {
        applied.push(settings.hideCompletionProbeEcho);
      },
    });

    await expect(controller.reload()).resolves.toEqual({ hideCompletionProbeEcho: true });
    await expect(controller.updateSettings({ hideCompletionProbeEcho: false })).resolves.toEqual({
      hideCompletionProbeEcho: false,
    });
    const reloaded = new GeneralSettingsController({
      settingsStoreDirectory: directory,
      apply: async (settings) => {
        applied.push(settings.hideCompletionProbeEcho);
      },
    });
    await expect(reloaded.reload()).resolves.toEqual({ hideCompletionProbeEcho: false });
    expect(applied).toEqual([true, false, false]);
  });
});
