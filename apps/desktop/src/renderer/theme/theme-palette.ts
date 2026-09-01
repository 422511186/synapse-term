import type { ITheme } from '@xterm/xterm';

import { HEX_COLOR_PATTERN } from '../../shared/contracts.js';
import type {
  CustomThemePalette,
  TerminalTextPalette,
  ThemeState,
} from '../../shared/contracts.js';

export type ThemeScheme = 'light' | 'dark';

// Default core colors used to seed a freshly enabled custom palette. The
// locked-in value is always the dark system palette; enabling custom colors on
// a light scheme repaints these so foreground and background stay readable.
export const SCHEME_CORE_PALETTES: Record<
  ThemeScheme,
  Omit<CustomThemePalette, 'enabled' | 'terminalText'>
> = {
  dark: { background: '#09090b', foreground: '#fafafa', accent: '#fafafa' },
  light: { background: '#ffffff', foreground: '#09090b', accent: '#09090b' },
};

// Returns the next custom palette for an enable/disable toggle. When enabling
// and the palette still holds the untouched built-in default values, the core
// colors are re-seeded from the current scheme so text never becomes invisible
// against the (possibly light) background. User-customized values are kept.
export function setCustomThemeEnabled(
  custom: CustomThemePalette,
  enabled: boolean,
  scheme: ThemeScheme,
): CustomThemePalette {
  if (!enabled) return { ...custom, enabled: false };
  const defaults = SCHEME_CORE_PALETTES.dark;
  const untouched =
    custom.background === defaults.background &&
    custom.foreground === defaults.foreground &&
    custom.accent === defaults.accent;
  if (!untouched) return { ...custom, enabled: true };
  return { ...custom, ...SCHEME_CORE_PALETTES[scheme], enabled: true };
}

// The CSS custom properties the desktop UI relies on. Values follow the zinc
// palette already defined for the built-in dark theme in prototype-tailwind.css.
export const BASE_THEME_PALETTES: Record<ThemeScheme, Record<string, string>> = {
  dark: {
    '--background': '#09090b',
    '--foreground': '#fafafa',
    '--card': '#09090b',
    '--card-foreground': '#fafafa',
    '--popover': '#18181b',
    '--popover-foreground': '#fafafa',
    '--primary': '#fafafa',
    '--primary-foreground': '#18181b',
    '--secondary': '#27272a',
    '--secondary-foreground': '#fafafa',
    '--muted': '#27272a',
    '--muted-foreground': '#a1a1aa',
    '--accent': '#27272a',
    '--accent-foreground': '#fafafa',
    '--destructive': '#7f1d1d',
    '--destructive-foreground': '#fafafa',
    '--border': '#27272a',
    '--input': '#27272a',
    '--ring': '#d4d4d8',
    '--terminal-bg': '#000000',
    '--terminal-fg': '#d4d4d8',
    // Semantic surfaces used by the custom component styles in styles.css.
    // Dark values mirror the current hardcoded palette so dark mode is unchanged.
    '--surface-raised': '#111113',
    '--surface-raised-2': '#101011',
    '--surface-button': '#202024',
    '--surface-dialog': '#171719',
    '--surface-input': '#0b0b0d',
    '--surface-hover': 'rgb(63 63 70 / 62%)',
    '--surface-hover-strong': 'rgb(63 63 70 / 82%)',
    '--surface-hover-soft': 'rgb(63 63 70 / 72%)',
    '--surface-hover-border': 'rgb(63 63 70 / 75%)',
    '--surface-active-border': 'rgb(63 63 70 / 78%)',
    '--surface-faint': 'rgb(82 82 91 / 30%)',
    '--surface-scroll': 'rgb(82 82 91 / 90%)',
    '--surface-scroll-hover': 'rgb(113 113 122 / 95%)',
    '--border-soft': '#3f3f46',
    '--border-input': '#52525b',
    '--text-body': '#e4e4e7',
    '--text-subtle': '#d4d4d8',
    '--text-faint': '#71717a',
    '--ui-surface-base': '#09090b',
    '--ui-text-primary': '#fafafa',
    '--ui-text-secondary': '#d4d4d8',
    '--ui-text-muted': '#a1a1aa',
    '--ui-text-disabled': '#71717a',
    '--ui-border-strong': '#a1a1aa',
    '--ui-focus-ring': '#93c5fd',
    '--ui-status-info-bg': '#172554',
    '--ui-status-info-fg': '#bfdbfe',
    '--ui-status-execution-bg': '#451a03',
    '--ui-status-execution-fg': '#fde68a',
    '--ui-status-success-bg': '#064e3b',
    '--ui-status-success-fg': '#a7f3d0',
    '--ui-status-warning-bg': '#78350f',
    '--ui-status-warning-fg': '#fde68a',
    '--ui-status-danger-bg': '#7f1d1d',
    '--ui-status-danger-fg': '#fecaca',
  },
  light: {
    '--background': '#ffffff',
    '--foreground': '#09090b',
    '--card': '#ffffff',
    '--card-foreground': '#09090b',
    '--popover': '#ffffff',
    '--popover-foreground': '#09090b',
    '--primary': '#09090b',
    '--primary-foreground': '#fafafa',
    '--secondary': '#f4f4f5',
    '--secondary-foreground': '#09090b',
    '--muted': '#f4f4f5',
    '--muted-foreground': '#71717a',
    '--accent': '#f4f4f5',
    '--accent-foreground': '#09090b',
    '--destructive': '#ef4444',
    '--destructive-foreground': '#ffffff',
    '--border': '#e4e4e7',
    '--input': '#e4e4e7',
    '--ring': '#09090b',
    '--terminal-bg': '#ffffff',
    '--terminal-fg': '#09090b',
    '--surface-raised': '#ffffff',
    '--surface-raised-2': '#fafafa',
    '--surface-button': '#f4f4f5',
    '--surface-dialog': '#ffffff',
    '--surface-input': '#ffffff',
    '--surface-hover': 'rgb(228 228 231 / 62%)',
    '--surface-hover-strong': 'rgb(228 228 231 / 82%)',
    '--surface-hover-soft': 'rgb(228 228 231 / 72%)',
    '--surface-hover-border': 'rgb(228 228 231 / 75%)',
    '--surface-active-border': 'rgb(228 228 231 / 78%)',
    '--surface-faint': 'rgb(113 113 122 / 16%)',
    '--surface-scroll': 'rgb(161 161 170 / 55%)',
    '--surface-scroll-hover': 'rgb(113 113 122 / 60%)',
    '--border-soft': '#e4e4e7',
    '--border-input': '#d4d4d8',
    '--text-body': '#18181b',
    '--text-subtle': '#3f3f46',
    '--text-faint': '#71717a',
    '--ui-surface-base': '#ffffff',
    '--ui-text-primary': '#18181b',
    '--ui-text-secondary': '#3f3f46',
    '--ui-text-muted': '#52525b',
    '--ui-text-disabled': '#71717a',
    '--ui-border-strong': '#71717a',
    '--ui-focus-ring': '#1d4ed8',
    '--ui-status-info-bg': '#eff6ff',
    '--ui-status-info-fg': '#1d4ed8',
    '--ui-status-execution-bg': '#fff7ed',
    '--ui-status-execution-fg': '#9a3412',
    '--ui-status-success-bg': '#f0fdf4',
    '--ui-status-success-fg': '#166534',
    '--ui-status-warning-bg': '#fffbeb',
    '--ui-status-warning-fg': '#92400e',
    '--ui-status-danger-bg': '#fef2f2',
    '--ui-status-danger-fg': '#b91c1c',
  },
};

function parseHex(value: string): [number, number, number] {
  const normalized = value.replace(/^#/, '');
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function relativeLuminance(color: string): number {
  const [red, green, blue] = parseHex(color);
  const linearize = (channel: number): number => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return linearize(red) * 0.2126 + linearize(green) * 0.7152 + linearize(blue) * 0.0722;
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

// Picks the black or white text color with the stronger contrast on a background.
export function readableOn(color: string): string {
  const darkText = '#09090b';
  const lightText = '#fafafa';
  return contrastRatio(darkText, color) >= contrastRatio(lightText, color) ? darkText : lightText;
}

export type CustomThemeContrastPair =
  'background-foreground' | 'accent-foreground' | 'accent-background';

export interface CustomThemeContrastIssue {
  pair: CustomThemeContrastPair;
  foreground: string;
  background: string;
  minimum: number;
  ratio: number;
}

// Core custom colors are saved as entered, but their combinations are checked
// before they are used for UI text, controls, and focus indicators.
export function getCustomThemeContrastIssues(
  customTheme: Pick<CustomThemePalette, 'background' | 'foreground' | 'accent'>,
): CustomThemeContrastIssue[] {
  const pairs: Array<{
    pair: CustomThemeContrastPair;
    foreground: string;
    background: string;
    minimum: number;
  }> = [
    {
      pair: 'background-foreground',
      foreground: customTheme.foreground,
      background: customTheme.background,
      minimum: 4.5,
    },
    {
      pair: 'accent-foreground',
      foreground: customTheme.foreground,
      background: customTheme.accent,
      minimum: 3,
    },
    {
      pair: 'accent-background',
      foreground: customTheme.accent,
      background: customTheme.background,
      minimum: 3,
    },
  ];
  return pairs
    .map((pair) => ({ ...pair, ratio: contrastRatio(pair.foreground, pair.background) }))
    .filter((pair) => pair.ratio < pair.minimum);
}

function readableTextColor(preferred: string, background: string): string {
  return contrastRatio(preferred, background) >= 4.5 ? preferred : readableOn(background);
}

function readableControlColor(preferred: string, background: string, fallback: string): string {
  if (contrastRatio(preferred, background) >= 3) return preferred;
  if (contrastRatio(fallback, background) >= 3) return fallback;
  return readableOn(background);
}

function paletteValue(palette: Record<string, string>, name: string): string {
  const value = palette[name];
  if (value === undefined) throw new Error(`Missing theme palette value: ${name}`);
  return value;
}

export function resolveThemeCssVariables(state: ThemeState): Record<string, string> {
  const variables: Record<string, string> = { ...BASE_THEME_PALETTES[state.scheme] };
  if (state.customTheme.enabled) {
    const { background, foreground, accent } = state.customTheme;
    variables['--background'] = background;
    variables['--card'] = background;
    variables['--popover'] = background;
    variables['--terminal-bg'] = background;
    variables['--foreground'] = foreground;
    variables['--card-foreground'] = foreground;
    variables['--popover-foreground'] = foreground;
    variables['--terminal-fg'] = foreground;
    variables['--primary'] = accent;
    variables['--ring'] = accent;
    variables['--primary-foreground'] = readableOn(accent);
    variables['--ui-surface-base'] = background;
    variables['--ui-text-primary'] = readableTextColor(foreground, background);
    variables['--ui-text-secondary'] = readableTextColor(foreground, background);
    variables['--ui-text-muted'] = readableTextColor(
      paletteValue(BASE_THEME_PALETTES[state.scheme], '--ui-text-muted'),
      background,
    );
    variables['--ui-text-disabled'] = readableTextColor(
      paletteValue(BASE_THEME_PALETTES[state.scheme], '--ui-text-disabled'),
      background,
    );
    const safeControlColor = readableControlColor(
      accent,
      background,
      paletteValue(BASE_THEME_PALETTES[state.scheme], '--ui-focus-ring'),
    );
    variables['--ui-border-strong'] = safeControlColor;
    variables['--ui-focus-ring'] = safeControlColor;
  }
  return variables;
}

export function applyThemeToDocument(state: ThemeState): void {
  const root = typeof document === 'undefined' ? undefined : document.documentElement;
  if (root === undefined) return;
  const variables = resolveThemeCssVariables(state);
  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }
  root.dataset.theme = state.scheme;
}

// Terminal text ANSI palettes differ per scheme so terminal output stays
// readable on the corresponding surface. When a custom theme is enabled and
// `terminalText` is customized, those values win over the scheme palette.
export const SCHEME_ANSI_PALETTES: Record<ThemeScheme, TerminalTextPalette> = {
  dark: {
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
  },
  light: {
    black: '#000000',
    red: '#dc2626',
    green: '#059669',
    yellow: '#b45309',
    blue: '#2563eb',
    magenta: '#9333ea',
    cyan: '#0891b2',
    white: '#52525b',
    brightBlack: '#71717a',
    brightRed: '#ef4444',
    brightGreen: '#10b981',
    brightYellow: '#d97706',
    brightBlue: '#3b82f6',
    brightMagenta: '#a855f7',
    brightCyan: '#06b6d4',
    brightWhite: '#18181b',
  },
};

// The ANSI fields in the order they map onto the xterm theme.
export const ANSI_TEXT_FIELDS: ReadonlyArray<keyof TerminalTextPalette> = [
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

function ansiOverrides(palette: TerminalTextPalette): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const key of ANSI_TEXT_FIELDS) overrides[key] = palette[key];
  return overrides;
}

// Resolves which ANSI palette the terminal should use for a theme state.
export function resolveTerminalTextPalette(state: ThemeState): TerminalTextPalette {
  if (state.customTheme.enabled && state.customTheme.terminalText !== undefined) {
    return state.customTheme.terminalText;
  }
  return SCHEME_ANSI_PALETTES[state.scheme];
}

export type TerminalTextEditResult =
  { applied: true; terminalText: TerminalTextPalette } | { applied: false };

// Produces the next custom terminal text palette for a color edit. Invalid
// colors are rejected and leave the palette untouched; when nothing is
// customized yet, the full palette is initialized from the current scheme so
// only the edited field differs from the built-in scheme colors.
export function applyTerminalTextEdit(
  current: TerminalTextPalette | undefined,
  scheme: ThemeScheme,
  key: keyof TerminalTextPalette,
  value: string,
): TerminalTextEditResult {
  if (!HEX_COLOR_PATTERN.test(value)) return { applied: false };
  const base = current ?? SCHEME_ANSI_PALETTES[scheme];
  return { applied: true, terminalText: { ...base, [key]: value } };
}

export function buildXtermTheme(state: ThemeState): ITheme {
  const text = resolveTerminalTextPalette(state);
  if (state.customTheme.enabled) {
    const { background, foreground, accent } = state.customTheme;
    return {
      ...ansiOverrides(text),
      background,
      foreground,
      cursor: accent,
      cursorAccent: readableOn(accent),
      selectionBackground: accent,
    };
  }
  const dark = state.scheme === 'dark';
  return {
    ...ansiOverrides(text),
    background: dark ? '#000000' : '#ffffff',
    foreground: dark ? '#d4d4d8' : '#09090b',
    cursor: dark ? '#34d399' : '#18181b',
    cursorAccent: dark ? '#000000' : '#ffffff',
    selectionBackground: dark ? '#27272a' : '#e4e4e7',
  };
}
