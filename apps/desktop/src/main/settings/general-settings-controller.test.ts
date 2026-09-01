import { describe, expect, it } from 'vitest';

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GeneralSettings } from './general-settings.js';
import { DEFAULT_GENERAL_SETTINGS } from './general-settings.js';
import { GeneralSettingsController } from './general-settings-controller.js';

describe('GeneralSettingsController', () => {
  it('applies the default and persisted preference through Main', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'synapse-term-general-controller-'));
    const applied: GeneralSettings[] = [];
    const controller = new GeneralSettingsController({
      settingsStoreDirectory: directory,
      apply: async (settings) => {
        applied.push(settings);
      },
    });

    await expect(controller.reload()).resolves.toEqual(DEFAULT_GENERAL_SETTINGS);
    await expect(controller.updateSettings({ hideCompletionProbeEcho: false })).resolves.toEqual({
      ...DEFAULT_GENERAL_SETTINGS,
      hideCompletionProbeEcho: false,
    });
    const reloaded = new GeneralSettingsController({
      settingsStoreDirectory: directory,
      apply: async (settings) => {
        applied.push(settings);
      },
    });
    await expect(reloaded.reload()).resolves.toEqual({
      ...DEFAULT_GENERAL_SETTINGS,
      hideCompletionProbeEcho: false,
    });
    expect(applied.map((settings) => settings.hideCompletionProbeEcho)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('applies theme mode and custom palette updates through Main', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'synapse-term-general-controller-'));
    const applied: GeneralSettings[] = [];
    const controller = new GeneralSettingsController({
      settingsStoreDirectory: directory,
      apply: async (settings) => {
        applied.push(settings);
      },
    });

    await controller.updateSettings({
      themeMode: 'light',
      customTheme: {
        enabled: true,
        background: '#111111',
        foreground: '#eeeeee',
        accent: '#3366ff',
      },
    });

    expect(applied.at(-1)).toEqual({
      ...DEFAULT_GENERAL_SETTINGS,
      themeMode: 'light',
      customTheme: {
        enabled: true,
        background: '#111111',
        foreground: '#eeeeee',
        accent: '#3366ff',
      },
    });
  });
});
