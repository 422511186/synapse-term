import { AlertTriangle, Check, ChevronRight, Monitor, Moon, RotateCcw, Sun } from 'lucide-react';
import type { JSX } from 'react';

import {
  HEX_COLOR_PATTERN,
  type CustomThemePalette,
  type TerminalTextPalette,
  type ThemeMode,
} from '../../shared/contracts.js';
import {
  applyTerminalTextEdit,
  ANSI_TEXT_FIELDS,
  buildXtermTheme,
  getCustomThemeContrastIssues,
  resetCustomCoreColors,
  SCHEME_ANSI_PALETTES,
  setCustomThemeEnabled,
} from './theme-palette.js';

const MODES: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
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

// 0-15 color-slot number for each ANSI field so the settings rows can be
// correlated with the numbered color sample printed by the Mock terminal.
const ANSI_SLOTS: Record<keyof TerminalTextPalette, number> = {
  black: 0,
  red: 1,
  green: 2,
  yellow: 3,
  blue: 4,
  magenta: 5,
  cyan: 6,
  white: 7,
  brightBlack: 8,
  brightRed: 9,
  brightGreen: 10,
  brightYellow: 11,
  brightBlue: 12,
  brightMagenta: 13,
  brightCyan: 14,
  brightWhite: 15,
};

const CONTRAST_ISSUE_LABELS = {
  'background-foreground': '背景色与前景色',
  'accent-foreground': '强调色与前景色',
  'accent-background': '强调色与背景色',
} as const;

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
    const result = applyTerminalTextEdit(settings.customTheme.terminalText, scheme, key, value);
    if (result.applied) {
      onSetCustomTheme({ ...settings.customTheme, terminalText: result.terminalText });
    }
  };

  const resetTerminalText = (): void => {
    onSetCustomTheme({ ...settings.customTheme, terminalText: undefined });
  };

  const resetCoreColors = (): void => {
    onSetCustomTheme(resetCustomCoreColors(settings.customTheme, scheme));
  };

  const terminalText = settings.customTheme.terminalText;
  const canEdit = !busy && settings.customTheme.enabled;
  const contrastIssues = settings.customTheme.enabled
    ? getCustomThemeContrastIssues(settings.customTheme)
    : [];
  const preview = buildXtermTheme({
    mode: settings.themeMode,
    scheme,
    customTheme: settings.customTheme,
  });

  return (
    <section
      aria-labelledby="theme-settings-title"
      className="mcp-settings-card theme-settings-card"
      data-testid="theme-settings-section"
    >
      <div className="settings-page-heading">
        <h2 id="theme-settings-title">外观</h2>
      </div>
      <div className="theme-mode-heading">
        <h3 id="theme-mode-label">主题模式</h3>
        <div
          aria-labelledby="theme-mode-label"
          className="mcp-mode-options theme-mode-options"
          role="radiogroup"
        >
          {MODES.map((mode) => {
            const Icon = mode.icon;
            return (
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
                <Icon aria-hidden="true" size={15} />
                <span className="mcp-mode-title">{mode.label}</span>
                {settings.themeMode === mode.value && (
                  <Check aria-hidden="true" className="mcp-mode-check" size={16} />
                )}
              </label>
            );
          })}
        </div>
      </div>

      <figure
        className="theme-preview"
        aria-label="终端配色预览"
        style={{ background: preview.background, color: preview.foreground }}
      >
        <figcaption>终端预览</figcaption>
        <pre>
          <span style={{ color: preview.green }}>synapse-term</span>{' '}
          <span style={{ color: preview.blue }}>main</span>
          {'\n$ git status --short\n'}
          <span style={{ color: preview.green }}>M src/app.ts</span>
          {'\n$ '}
          <span className="theme-preview-cursor" aria-hidden="true" />
        </pre>
        <div className="theme-preview-swatches" aria-hidden="true">
          {ANSI_TEXT_FIELDS.slice(0, 8).map((key) => (
            <span key={key} style={{ background: preview[key] }} />
          ))}
        </div>
      </figure>

      <div className="theme-custom-block">
        <div className="theme-custom-heading">
          <h3>自定义核心配色</h3>
          <div className="theme-custom-actions">
            <button
              aria-label="重置核心配色"
              className="theme-terminal-reset"
              disabled={!canEdit}
              onClick={resetCoreColors}
              title="重置核心配色"
              type="button"
            >
              <RotateCcw aria-hidden="true" size={13} />
              重置核心配色
            </button>
            <label className="mcp-switch-control">
              <input
                aria-label="启用自定义配色"
                checked={settings.customTheme.enabled}
                disabled={busy}
                onChange={(event) =>
                  onSetCustomTheme(
                    setCustomThemeEnabled(settings.customTheme, event.target.checked, scheme),
                  )
                }
                type="checkbox"
              />
              <span aria-hidden="true" className="mcp-switch-track">
                <span className="mcp-switch-thumb" />
              </span>
            </label>
          </div>
        </div>

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

        {contrastIssues.length > 0 && (
          <div aria-live="polite" className="theme-contrast-warning" role="alert">
            <AlertTriangle aria-hidden="true" size={16} />
            <div>
              <strong>自定义配色对比度不足</strong>
              <p>
                当前界面将使用安全文字色。以下组合需要调整：{' '}
                {contrastIssues.map((issue) => CONTRAST_ISSUE_LABELS[issue.pair]).join('、')}。
                已保存的合法颜色值仍会保留。
              </p>
            </div>
          </div>
        )}

        <details className="theme-terminal-details">
          <summary>
            <ChevronRight aria-hidden="true" size={16} />
            <span>终端文字配色</span>
            <span className="theme-terminal-count">16 色</span>
          </summary>
          {terminalText !== undefined && (
            <div className="theme-terminal-heading">
              <button
                aria-label="恢复默认终端文字配色"
                className="theme-terminal-reset"
                disabled={!canEdit}
                onClick={resetTerminalText}
                type="button"
                title="恢复默认终端文字配色"
              >
                <RotateCcw aria-hidden="true" size={13} />
                恢复默认
              </button>
            </div>
          )}

          <div className="theme-color-grid">
            {ANSI_TEXT_FIELDS.map((key) => {
              const value = terminalText?.[key] ?? SCHEME_ANSI_PALETTES[scheme][key];
              return (
                <label className="theme-color-row" key={key}>
                  <span className="theme-color-label">
                    <span className="theme-color-slot">{ANSI_SLOTS[key]}</span>
                    {ANSI_LABELS[key]}
                  </span>
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
        </details>
      </div>
    </section>
  );
}
