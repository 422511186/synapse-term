import { describe, expect, it } from 'vitest';

import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createGeneralSettingsStore,
  DEFAULT_CUSTOM_THEME,
  DEFAULT_GENERAL_SETTINGS,
  sanitizeGeneralSettings,
} from './general-settings.js';

describe('General settings', () => {
  it('defaults to system theme with disabled custom palette and accepts valid theme fields', () => {
    expect(sanitizeGeneralSettings(undefined)).toEqual(DEFAULT_GENERAL_SETTINGS);
    expect(sanitizeGeneralSettings({ hideCompletionProbeEcho: false })).toEqual({
      ...DEFAULT_GENERAL_SETTINGS,
      hideCompletionProbeEcho: false,
    });
    expect(sanitizeGeneralSettings({ hideCompletionProbeEcho: 'false' })).toEqual(
      DEFAULT_GENERAL_SETTINGS,
    );
  });

  it('accepts a valid theme mode and custom palette', () => {
    expect(
      sanitizeGeneralSettings({
        hideCompletionProbeEcho: false,
        themeMode: 'light',
        customTheme: {
          enabled: true,
          background: '#111111',
          foreground: '#eeeeee',
          accent: '#3366ff',
        },
      }),
    ).toEqual({
      hideCompletionProbeEcho: false,
      themeMode: 'light',
      customTheme: {
        enabled: true,
        background: '#111111',
        foreground: '#eeeeee',
        accent: '#3366ff',
      },
    });
  });

  it('rejects invalid theme mode and malformed palette colors', () => {
    const sanitized = sanitizeGeneralSettings({
      themeMode: 'sepia',
      customTheme: {
        enabled: 'yes',
        background: 'white',
        foreground: '#GGGGGG',
        accent: 123,
      },
    });
    expect(sanitized.themeMode).toBe(DEFAULT_GENERAL_SETTINGS.themeMode);
    expect(sanitized.customTheme).toEqual(DEFAULT_CUSTOM_THEME);
  });

  it('persists only the validated general setting including theme fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'synapse-term-general-'));
    const store = createGeneralSettingsStore(directory);
    const saved = {
      hideCompletionProbeEcho: false,
      themeMode: 'dark' as const,
      customTheme: {
        enabled: true,
        background: '#000001',
        foreground: '#fefefe',
        accent: '#00ff00',
      },
    };
    await store.save(saved);

    expect(await store.load()).toEqual(saved);
    expect(JSON.parse(await readFile(store.path, 'utf8'))).toEqual(saved);
  });
});
