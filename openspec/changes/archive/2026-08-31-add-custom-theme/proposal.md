## Why

桌面端目前是硬编码的深色外观（`#09090b` 等字面色散落在 JSX 与自定义 CSS 中），用户无法切换浅色/深色，也无法跟随系统外观，更不能按个人偏好调整配色。终端类产品对外观敏感，需要提供主题选择与基础的自定义配色能力。

## What Changes

- 新增主题设置模型：`themeMode`（`light` / `dark` / `system`，默认 `system`）与 `customTheme` 核心配色（`enabled` + `background` / `foreground` / `accent` 三色，默认关闭）。
- Main 进程持久化主题设置（沿用 `general.json`），应用时设置 `nativeTheme.themeSource`、同步窗口背景色，并在设置变更或系统外观变化时向 Renderer 广播 `ThemeState`。
- Preload 新增受限 API：`api.theme.getState()` 读取当前主题状态（含有效 scheme），`api.theme.onChanged()` 订阅变化。
- Renderer 新增主题引擎：内置浅色/深色两套 CSS 变量调色板，叠加自定义核心配色后应用到文档根节点；xterm 终端配色随主题变化。
- 将工作区、Header、新建会话、设置工作区等主要表面的硬编码颜色改为主题 CSS 变量；设置工作区新增「外观 / 主题」区块（浅色 / 深色 / 跟随系统 + 自定义配色编辑器，实时预览）。
- Mock 开发模式同步提供主题状态，便于 `pnpm dev` 下预览。

## Capabilities

### New Capabilities

- `theme-customization`: 主题模式选择（浅色 / 深色 / 跟随系统）、自定义核心配色（背景 / 前景 / 强调色）以及将其应用到桌面 UI 与终端表面的行为。

### Modified Capabilities

- `settings-workspace`: 设置工作区从仅承载通用显示与 MCP 区块，扩展为同时提供「外观 / 主题」配置区块（模式选择与自定义配色编辑）。

## Impact

- 代码：`contracts.ts` 与 `general-settings.ts`（主题字段与 sanitize）、`general-settings-controller.ts`、`electron-main.ts`（apply + nativeTheme + 广播）、`electron-window.ts`（窗口背景同步）、`preload-api.ts`、`desktop-ipc-channels.ts`（`theme:changed` 事件）、`mock-api.ts`、`app.tsx`、`terminal-view.tsx` 与 `prototype-terminal.ts`、`settings-workspace.tsx`、`styles.css`（主题变量化）；新增 `renderer/theme/`（调色板与设置视图）。
- 依赖：无新增运行时依赖。
- 数据：`general.json` 新增字段，sanitize 白名单校验缺失字段回退默认；旧文件可直接读取。
- 验证：`pnpm verify`（格式、ESLint、类型检查、Vitest）与 `pnpm test:e2e` 新增主题切换场景。
