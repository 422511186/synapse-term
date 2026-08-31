import type { ITheme } from '@xterm/xterm';

import type { TerminalTextPalette, ThemeState } from '../../shared/contracts.js';

export type ThemeScheme = 'light' | 'dark';

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

// Picks black or white text that stays readable on the given background color.
export function readableOn(color: string): string {
  const [red, green, blue] = parseHex(color);
  // WCAG relative luminance approximation.
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 140 ? '#09090b' : '#fafafa';
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
