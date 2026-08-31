import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CustomThemePalette, ThemeMode } from '../../shared/contracts.js';
import { HEX_COLOR_PATTERN } from '../../shared/contracts.js';

export interface GeneralSettings {
  hideCompletionProbeEcho: boolean;
  themeMode: ThemeMode;
  customTheme: CustomThemePalette;
}

export const DEFAULT_CUSTOM_THEME: CustomThemePalette = Object.freeze({
  enabled: false,
  background: '#09090b',
  foreground: '#fafafa',
  accent: '#fafafa',
});

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = Object.freeze({
  hideCompletionProbeEcho: true,
  themeMode: 'system',
  customTheme: DEFAULT_CUSTOM_THEME,
});

const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

function sanitizeHexColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value) ? value : fallback;
}

function sanitizeCustomTheme(value: unknown): CustomThemePalette {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return structuredClone(DEFAULT_CUSTOM_THEME);
  }
  const record = value as Record<string, unknown>;
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_CUSTOM_THEME.enabled,
    background: sanitizeHexColor(record.background, DEFAULT_CUSTOM_THEME.background),
    foreground: sanitizeHexColor(record.foreground, DEFAULT_CUSTOM_THEME.foreground),
    accent: sanitizeHexColor(record.accent, DEFAULT_CUSTOM_THEME.accent),
  };
}

export function sanitizeGeneralSettings(value: unknown): GeneralSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return structuredClone(DEFAULT_GENERAL_SETTINGS);
  }
  const record = value as Record<string, unknown>;
  return {
    hideCompletionProbeEcho:
      typeof record.hideCompletionProbeEcho === 'boolean'
        ? record.hideCompletionProbeEcho
        : DEFAULT_GENERAL_SETTINGS.hideCompletionProbeEcho,
    themeMode: THEME_MODES.includes(record.themeMode as ThemeMode)
      ? (record.themeMode as ThemeMode)
      : DEFAULT_GENERAL_SETTINGS.themeMode,
    customTheme: sanitizeCustomTheme(record.customTheme),
  };
}

export interface GeneralSettingsStore {
  load(): Promise<GeneralSettings>;
  save(settings: GeneralSettings): Promise<void>;
  readonly path: string;
}

export function createGeneralSettingsStore(directory: string): GeneralSettingsStore {
  const path = join(directory, 'general.json');
  return {
    path,
    async load() {
      try {
        return sanitizeGeneralSettings(JSON.parse(await readFile(path, 'utf8')) as unknown);
      } catch {
        return structuredClone(DEFAULT_GENERAL_SETTINGS);
      }
    },
    async save(settings) {
      await mkdir(directory, { recursive: true });
      const temporaryPath = `${path}.tmp`;
      await writeFile(
        temporaryPath,
        `${JSON.stringify(sanitizeGeneralSettings(settings), null, 2)}\n`,
        'utf8',
      );
      await rename(temporaryPath, path);
    },
  };
}
