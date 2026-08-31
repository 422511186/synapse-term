import { Check, Palette, RotateCcw } from 'lucide-react';
import type { JSX } from 'react';

import {
  HEX_COLOR_PATTERN,
  type CustomThemePalette,
  type TerminalTextPalette,
  type ThemeMode,
} from '../../shared/contracts.js';
import { ANSI_TEXT_FIELDS, SCHEME_ANSI_PALETTES } from './theme-palette.js';

const MODES: Array<{ value: ThemeMode; label: string; description: string }> = [
  { value: 'light', label: '浅色', description: '使用明亮的外观配色。' },
  { value: 'dark', label: '深色', description: '使用深邃的外观配色。' },
  { value: 'system', label: '跟随系统', description: '跟随操作系统外观自动切换。' },
];

const COLOR_FIELDS: Array<{
  key: keyof Pick<CustomThemePalette, 'background' | 'foreground' | 'accent'>;
  label: string;
}> = [
  { key: 'background', label: '背景色' },
  { key: 'foreground', label: '前景色' },
  { key: 'accent', label: '强调色' },
];

const ANSI_LABELS: Record<keyof TerminalTextPalette, string> = {
  black: '黑',
  red: '红',
  green: '绿',
  yellow: '黄',
  blue: '蓝',
  magenta: '品红',
  cyan: '青',
  white: '白',
  brightBlack: '亮黑',
  brightRed: '亮红',
  brightGreen: '亮绿',
  brightYellow: '亮黄',
  brightBlue: '亮蓝',
  brightMagenta: '亮品红',
  brightCyan: '亮青',
  brightWhite: '亮白',
};

export interface ThemeSettingsViewProps {
  busy: boolean;
  scheme: 'light' | 'dark';
  settings: { themeMode: ThemeMode; customTheme: CustomThemePalette };
  onSetMode: (mode: ThemeMode) => void;
  onSetCustomTheme: (palette: CustomThemePalette) => void;
}

export function ThemeSettingsView({
  busy,
  scheme,
  settings,
  onSetMode,
  onSetCustomTheme,
}: ThemeSettingsViewProps): JSX.Element {
  const updateColor = (key: keyof CustomThemePalette, value: string): void => {
    // Reject malformed colors and keep the last valid value.
    if (!HEX_COLOR_PATTERN.test(value)) return;
    onSetCustomTheme({ ...settings.customTheme, [key]: value });
  };

  const updateTerminalColor = (key: keyof TerminalTextPalette, value: string): void => {
    if (!HEX_COLOR_PATTERN.test(value)) return;
    const base = settings.customTheme.terminalText ?? SCHEME_ANSI_PALETTES[scheme];
    onSetCustomTheme({ ...settings.customTheme, terminalText: { ...base, [key]: value } });
  };

  const resetTerminalText = (): void => {
    onSetCustomTheme({ ...settings.customTheme, terminalText: undefined });
  };

  const terminalText = settings.customTheme.terminalText;
  const canEdit = !busy && settings.customTheme.enabled;

  return (
    <section
      aria-labelledby="theme-settings-title"
      className="mcp-settings-card theme-settings-card"
      data-testid="theme-settings-section"
    >
      <div className="mcp-card-heading">
        <div className="mcp-card-kicker">
          <Palette aria-hidden="true" size={14} /> 外观
        </div>
        <h3 id="theme-settings-title">主题</h3>
        <p>选择浅色、深色或跟随系统外观，也可以自定义核心配色与终端文字。</p>
      </div>

      <div
        aria-labelledby="theme-settings-title"
        className="mcp-mode-options theme-mode-options"
        role="radiogroup"
      >
        {MODES.map((mode) => (
          <label
            className={`mcp-mode-option ${settings.themeMode === mode.value ? 'is-selected' : ''}`}
            key={mode.value}
          >
            <input
              aria-label={mode.label}
              checked={settings.themeMode === mode.value}
              disabled={busy}
              name="theme-mode"
              onChange={() => onSetMode(mode.value)}
              type="radio"
              value={mode.value}
            />
            <span className="mcp-mode-radio" aria-hidden="true" />
            <span className="mcp-mode-copy">
              <span className="mcp-mode-title">{mode.label}</span>
              <span className="mcp-mode-description">{mode.description}</span>
            </span>
            {settings.themeMode === mode.value && (
              <Check aria-hidden="true" className="mcp-mode-check" size={16} />
            )}
          </label>
        ))}
      </div>

      <div className="theme-custom-block">
        <label className="mcp-switch-control">
          <input
            aria-label="启用自定义配色"
            checked={settings.customTheme.enabled}
            disabled={busy}
            onChange={(event) =>
              onSetCustomTheme({ ...settings.customTheme, enabled: event.target.checked })
            }
            type="checkbox"
          />
          <span aria-hidden="true" className="mcp-switch-track">
            <span className="mcp-switch-thumb" />
          </span>
          <span className="mcp-switch-label">自定义核心配色</span>
        </label>

        <div className="theme-color-fields">
          {COLOR_FIELDS.map((field) => (
            <label className="theme-color-row" key={field.key}>
              <span className="theme-color-label">{field.label}</span>
              <input
                aria-label={`${field.label} 输入`}
                className="theme-color-input"
                disabled={!canEdit}
                onChange={(event) => updateColor(field.key, event.target.value)}
                spellCheck={false}
                type="text"
                value={settings.customTheme[field.key]}
              />
              <input
                aria-label={`${field.label} 选择器`}
                className="theme-color-swatch"
                disabled={!canEdit}
                onChange={(event) => updateColor(field.key, event.target.value)}
                type="color"
                value={settings.customTheme[field.key]}
              />
            </label>
          ))}
        </div>

        <div className="theme-terminal-heading">
          <div>
            <p className="theme-terminal-title">终端文字配色</p>
            <p className="theme-terminal-note">
              未定制时终端文字跟随当前浅色/深色主题；定制后覆盖内置 ANSI 色板。
            </p>
          </div>
          {terminalText !== undefined && (
            <button
              aria-label="恢复默认终端文字配色"
              className="theme-terminal-reset"
              disabled={!canEdit}
              onClick={resetTerminalText}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={13} />
              恢复默认
            </button>
          )}
        </div>

        <div className="theme-color-grid">
          {ANSI_TEXT_FIELDS.map((key) => {
            const value = terminalText?.[key] ?? SCHEME_ANSI_PALETTES[scheme][key];
            return (
              <label className="theme-color-row" key={key}>
                <span className="theme-color-label">{ANSI_LABELS[key]}</span>
                <input
                  aria-label={`终端文字 ${ANSI_LABELS[key]} 输入`}
                  className="theme-color-input"
                  disabled={!canEdit}
                  onChange={(event) => updateTerminalColor(key, event.target.value)}
                  spellCheck={false}
                  type="text"
                  value={value}
                />
                <input
                  aria-label={`终端文字 ${ANSI_LABELS[key]} 选择器`}
                  className="theme-color-swatch"
                  disabled={!canEdit}
                  onChange={(event) => updateTerminalColor(key, event.target.value)}
                  type="color"
                  value={value}
                />
              </label>
            );
          })}
        </div>

        <p className="theme-custom-note">
          自定义配色会覆盖内置主题的背景、前景与强调色，并可选覆盖终端文字 16
          色；其余颜色沿用当前主题的默认值。
        </p>
      </div>
    </section>
  );
}
