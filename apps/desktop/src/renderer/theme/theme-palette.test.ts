import { describe, expect, it, vi } from 'vitest';

import type { CustomThemePalette, ThemeState } from '../../shared/contracts.js';
import {
  applyTerminalTextEdit,
  BASE_THEME_PALETTES,
  SCHEME_ANSI_PALETTES,
  applyThemeToDocument,
  buildXtermTheme,
  readableOn,
  resolveTerminalTextPalette,
  resolveThemeCssVariables,
  SCHEME_CORE_PALETTES,
  setCustomThemeEnabled,
} from './theme-palette.js';

const darkState: ThemeState = {
  mode: 'system',
  scheme: 'dark',
  customTheme: { enabled: false, background: '#09090b', foreground: '#fafafa', accent: '#fafafa' },
};

const lightState: ThemeState = {
  mode: 'light',
  scheme: 'light',
  customTheme: { enabled: false, background: '#ffffff', foreground: '#09090b', accent: '#09090b' },
};

describe('theme palette', () => {
  it('exposes complete dark and light base palettes with distinct surface colors', () => {
    expect(BASE_THEME_PALETTES.dark['--background']).toBe('#09090b');
    expect(BASE_THEME_PALETTES.dark['--foreground']).toBe('#fafafa');
    expect(BASE_THEME_PALETTES.light['--background']).toBe('#ffffff');
    expect(BASE_THEME_PALETTES.light['--foreground']).toBe('#09090b');
    expect(BASE_THEME_PALETTES.dark['--border']).not.toBe(BASE_THEME_PALETTES.light['--border']);
    expect(BASE_THEME_PALETTES.dark['--terminal-bg']).toBe('#000000');
    expect(BASE_THEME_PALETTES.light['--terminal-bg']).toBe('#ffffff');
  });

  it('resolves the base palette for a scheme when custom colors are disabled', () => {
    expect(resolveThemeCssVariables(darkState)).toEqual(BASE_THEME_PALETTES.dark);
    expect(resolveThemeCssVariables(lightState)).toEqual(BASE_THEME_PALETTES.light);
  });

  it('maps custom core colors onto surface, text and accent variables', () => {
    const state: ThemeState = {
      mode: 'dark',
      scheme: 'dark',
      customTheme: {
        enabled: true,
        background: '#101418',
        foreground: '#e8eef2',
        accent: '#3b82f6',
      },
    };
    const variables = resolveThemeCssVariables(state);
    expect(variables['--background']).toBe('#101418');
    expect(variables['--card']).toBe('#101418');
    expect(variables['--popover']).toBe('#101418');
    expect(variables['--terminal-bg']).toBe('#101418');
    expect(variables['--foreground']).toBe('#e8eef2');
    expect(variables['--terminal-fg']).toBe('#e8eef2');
    expect(variables['--primary']).toBe('#3b82f6');
    expect(variables['--ring']).toBe('#3b82f6');
    // Dark accent gets light readable text.
    expect(variables['--primary-foreground']).toBe('#fafafa');
  });

  it('picks a readable foreground color from the accent luminance', () => {
    expect(readableOn('#ffffff')).toBe('#09090b');
    expect(readableOn('#000000')).toBe('#fafafa');
  });

  it('applies the resolved variables to the document root', () => {
    const properties = new Map<string, string>();
    const documentStub = {
      documentElement: {
        style: {
          setProperty: (name: string, value: string) => properties.set(name, value),
        },
        dataset: {} as Record<string, string>,
      },
    };
    vi.stubGlobal('document', documentStub);
    try {
      applyThemeToDocument({
        ...darkState,
        customTheme: { ...darkState.customTheme, enabled: true, background: '#111111' },
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(properties.get('--background')).toBe('#111111');
  });

  it('builds an xterm theme that follows the scheme and custom palette', () => {
    const darkTerminal = buildXtermTheme(darkState);
    expect(darkTerminal.background).toBe('#000000');
    expect(darkTerminal.foreground).toBe('#d4d4d8');

    const customTerminal = buildXtermTheme({
      ...darkState,
      customTheme: {
        enabled: true,
        background: '#101418',
        foreground: '#e8eef2',
        accent: '#3b82f6',
      },
    });
    expect(customTerminal.background).toBe('#101418');
    expect(customTerminal.foreground).toBe('#e8eef2');
    expect(customTerminal.cursor).toBe('#3b82f6');
  });

  it('provides distinct terminal text palettes for light and dark schemes', () => {
    expect(SCHEME_ANSI_PALETTES.dark.red).not.toBe(SCHEME_ANSI_PALETTES.light.red);
    expect(SCHEME_ANSI_PALETTES.light.red).toBe('#dc2626');
    expect(SCHEME_ANSI_PALETTES.dark.red).toBe('#f87171');
    // Every field of the palette is defined for both schemes.
    for (const key of Object.keys(SCHEME_ANSI_PALETTES.dark)) {
      expect(
        SCHEME_ANSI_PALETTES.light[key as keyof typeof SCHEME_ANSI_PALETTES.dark],
      ).toBeTruthy();
    }
  });

  it('lets the xterm ANSI colors follow the scheme when terminal text is not customized', () => {
    const darkTerminal = buildXtermTheme(darkState);
    expect(darkTerminal.red).toBe('#f87171');
    const lightTerminal = buildXtermTheme(lightState);
    expect(lightTerminal.red).toBe('#dc2626');
    // A custom theme without terminalText still falls back to the scheme palette.
    const customWithoutText = buildXtermTheme({
      ...darkState,
      customTheme: {
        enabled: true,
        background: '#101418',
        foreground: '#e8eef2',
        accent: '#3b82f6',
      },
    });
    expect(customWithoutText.red).toBe('#f87171');
  });

  it('applies a customized terminal text palette over the scheme defaults', () => {
    const state: ThemeState = {
      ...darkState,
      customTheme: {
        enabled: true,
        background: '#101418',
        foreground: '#e8eef2',
        accent: '#3b82f6',
        terminalText: { ...SCHEME_ANSI_PALETTES.dark, red: '#ff0000', green: '#00ff00' },
      },
    };
    const terminal = buildXtermTheme(state);
    expect(terminal.red).toBe('#ff0000');
    expect(terminal.green).toBe('#00ff00');
    expect(terminal.black).toBe(SCHEME_ANSI_PALETTES.dark.black);
  });

  it('resolves the terminal text palette from the custom theme or the scheme', () => {
    expect(resolveTerminalTextPalette(darkState)).toBe(SCHEME_ANSI_PALETTES.dark);
    const custom = { ...SCHEME_ANSI_PALETTES.dark, blue: '#0000ff' };
    const state: ThemeState = {
      ...darkState,
      customTheme: {
        enabled: true,
        background: '#101418',
        foreground: '#e8eef2',
        accent: '#3b82f6',
        terminalText: custom,
      },
    };
    expect(resolveTerminalTextPalette(state)).toBe(custom);
  });

  describe('applyTerminalTextEdit', () => {
    it('rejects an invalid color without producing a new palette', () => {
      const result = applyTerminalTextEdit(SCHEME_ANSI_PALETTES.dark, 'dark', 'red', 'nope');
      expect(result).toEqual({ applied: false });
    });

    it('initializes the full 16-color palette from the scheme when nothing is customized yet', () => {
      const result = applyTerminalTextEdit(undefined, 'light', 'red', '#ff0000');
      expect(result).toEqual({
        applied: true,
        terminalText: { ...SCHEME_ANSI_PALETTES.light, red: '#ff0000' },
      });
    });

    it('edits the existing custom palette in place without touching other fields', () => {
      const base = { ...SCHEME_ANSI_PALETTES.dark, red: '#aa0000' };
      const result = applyTerminalTextEdit(base, 'dark', 'green', '#00ff00');
      expect(result).toEqual({ applied: true, terminalText: { ...base, green: '#00ff00' } });
    });
  });

  describe('setCustomThemeEnabled', () => {
    const untouched: CustomThemePalette = {
      enabled: false,
      background: '#09090b',
      foreground: '#fafafa',
      accent: '#fafafa',
    };

    it('seeds scheme-appropriate core colors when customizing a fresh dark default palette', () => {
      // The locked-in default palette always starts as the dark system values;
      // enabling custom colors on a light scheme must repaint the core colors
      // so foreground/background never collide (e.g. white text on white bg).
      const result = setCustomThemeEnabled(untouched, true, 'light');
      expect(result.enabled).toBe(true);
      expect(result.background).toBe(SCHEME_CORE_PALETTES.light.background);
      expect(result.foreground).toBe(SCHEME_CORE_PALETTES.light.foreground);
      expect(result.accent).toBe(SCHEME_CORE_PALETTES.light.accent);
    });

    it('keeps the dark scheme defaults when customizing under a dark scheme', () => {
      const result = setCustomThemeEnabled(untouched, true, 'dark');
      expect(result).toEqual({ ...untouched, enabled: true });
    });

    it('preserves user-customized core colors when re-enabling', () => {
      const customized: CustomThemePalette = {
        ...untouched,
        background: '#112233',
        foreground: '#ddeeff',
        accent: '#aa3366',
      };
      const result = setCustomThemeEnabled(customized, true, 'light');
      expect(result.background).toBe('#112233');
      expect(result.foreground).toBe('#ddeeff');
      expect(result.accent).toBe('#aa3366');
    });

    it('merges an existing terminalText and only flips the enabled flag when disabled', () => {
      const withText: CustomThemePalette = {
        ...untouched,
        enabled: true,
        terminalText: { ...SCHEME_ANSI_PALETTES.dark, red: '#ff0000' },
      };
      const disabled = setCustomThemeEnabled(withText, false, 'light');
      expect(disabled.enabled).toBe(false);
      expect(disabled.terminalText).toBe(withText.terminalText);
    });
  });
});
