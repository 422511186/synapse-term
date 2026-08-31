import { Check, Palette } from 'lucide-react';
import type { JSX } from 'react';

import {
  HEX_COLOR_PATTERN,
  type CustomThemePalette,
  type ThemeMode,
} from '../../shared/contracts.js';

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

export interface ThemeSettingsViewProps {
  busy: boolean;
  settings: { themeMode: ThemeMode; customTheme: CustomThemePalette };
  onSetMode: (mode: ThemeMode) => void;
  onSetCustomTheme: (palette: CustomThemePalette) => void;
}

export function ThemeSettingsView({
  busy,
  settings,
  onSetMode,
  onSetCustomTheme,
}: ThemeSettingsViewProps): JSX.Element {
  const updateColor = (key: keyof CustomThemePalette, value: string): void => {
    // Reject malformed colors and keep the last valid value.
    if (!HEX_COLOR_PATTERN.test(value)) return;
    onSetCustomTheme({ ...settings.customTheme, [key]: value });
  };

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
        <p>选择浅色、深色或跟随系统外观，也可以自定义核心配色。</p>
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
                disabled={busy || !settings.customTheme.enabled}
                onChange={(event) => updateColor(field.key, event.target.value)}
                spellCheck={false}
                type="text"
                value={settings.customTheme[field.key]}
              />
              <input
                aria-label={`${field.label} 选择器`}
                className="theme-color-swatch"
                disabled={busy || !settings.customTheme.enabled}
                onChange={(event) => updateColor(field.key, event.target.value)}
                type="color"
                value={settings.customTheme[field.key]}
              />
            </label>
          ))}
        </div>

        <p className="theme-custom-note">
          自定义配色会覆盖内置主题的背景、前景与强调色，其余颜色沿用当前主题的默认值。
        </p>
      </div>
    </section>
  );
}
