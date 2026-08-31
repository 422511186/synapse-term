import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { HEX_COLOR_PATTERN } from '../../shared/contracts.js';
import { createMockDesktopApi } from '../mock-api.js';
import { ThemeSettingsView } from './theme-settings-view.js';

describe('ThemeSettingsView', () => {
  it('renders the three theme modes and the custom palette editor', () => {
    const markup = renderToStaticMarkup(
      <ThemeSettingsView
        busy={false}
        onSetCustomTheme={vi.fn()}
        onSetMode={vi.fn()}
        settings={{
          themeMode: 'system',
          customTheme: {
            enabled: true,
            background: '#101418',
            foreground: '#e8eef2',
            accent: '#3b82f6',
          },
        }}
      />,
    );
    expect(markup).toContain('主题');
    expect(markup).toContain('浅色');
    expect(markup).toContain('深色');
    expect(markup).toContain('跟随系统');
    expect(markup).toContain('自定义核心配色');
    expect(markup).toContain('背景色');
    expect(markup).toContain('前景色');
    expect(markup).toContain('强调色');
    expect(markup).toContain('#101418');
  });

  it('selects the active mode and disables palette controls when busy or custom colors are off', () => {
    const markup = renderToStaticMarkup(
      <ThemeSettingsView
        busy
        onSetCustomTheme={vi.fn()}
        onSetMode={vi.fn()}
        settings={{
          themeMode: 'dark',
          customTheme: {
            enabled: false,
            background: '#09090b',
            foreground: '#fafafa',
            accent: '#fafafa',
          },
        }}
      />,
    );
    expect(markup).toContain('name="theme-mode"');
    expect(markup).toContain('checked=""');
    expect(markup).toContain('disabled=""');
  });

  it('only accepts strict six-digit hex colors for the custom palette', () => {
    expect(HEX_COLOR_PATTERN.test('#101418')).toBe(true);
    expect(HEX_COLOR_PATTERN.test('#abcdef')).toBe(true);
    expect(HEX_COLOR_PATTERN.test('white')).toBe(false);
    expect(HEX_COLOR_PATTERN.test('#GGGGGG')).toBe(false);
    expect(HEX_COLOR_PATTERN.test('#12345')).toBe(false);
  });
});

describe('mock theme state integration', () => {
  it('exposes theme state and applies mode changes through the mock API', async () => {
    const api = createMockDesktopApi();
    await expect(api.theme.getState()).resolves.toMatchObject({ mode: 'system', scheme: 'dark' });
    await api.general.updateSettings({ themeMode: 'light' });
    await expect(api.theme.getState()).resolves.toMatchObject({ mode: 'light' });
  });
});
