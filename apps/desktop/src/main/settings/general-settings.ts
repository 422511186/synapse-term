import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CustomThemePalette, TerminalTextPalette, ThemeMode } from '../../shared/contracts.js';
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

// Fallback ANSI values used only when a persisted terminalText field is
// missing or invalid; the renderer resolves the effective palette from the
// scheme when the custom theme does not override terminal text.
export const DEFAULT_TERMINAL_TEXT: TerminalTextPalette = Object.freeze({
  black: '#000000',
  red: '#f87171',
  green: '#34d399',
  yellow: '#fcd34d',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#d4d4d8',
  brightBlack: '#71717a',
  brightRed: '#fb923c',
  brightGreen: '#4ade80',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#f4f4f5',
});

const TERMINAL_TEXT_KEYS: readonly (keyof TerminalTextPalette)[] = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
];

function sanitizeHexColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value) ? value : fallback;
}

function sanitizeTerminalText(value: unknown): TerminalTextPalette | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const palette = { ...DEFAULT_TERMINAL_TEXT };
  for (const key of TERMINAL_TEXT_KEYS) {
    palette[key] = sanitizeHexColor(record[key], DEFAULT_TERMINAL_TEXT[key]);
  }
  return palette;
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
    terminalText: sanitizeTerminalText(record.terminalText),
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
