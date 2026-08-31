import { describe, expect, it, vi } from 'vitest';

import type { ThemeState } from '../../shared/contracts.js';
import {
  BASE_THEME_PALETTES,
  applyThemeToDocument,
  buildXtermTheme,
  readableOn,
  resolveThemeCssVariables,
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
});
