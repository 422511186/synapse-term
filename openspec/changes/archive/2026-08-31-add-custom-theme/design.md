# Design: Add Custom Theme

## Context

现状（见 proposal.md - Why）：桌面端外观被硬编码为深色。主题相关的 CSS 变量（`--background`、`--foreground`、`--border`、`--primary`、`--muted`、`--card` 等）定义在 `renderer/prototype-tailwind.css` 的 `:root`，Tailwind 工具类（`text-foreground`、`border-border`、`bg-card` 等）直接映射这些变量；但工作区、Header、新建会话、设置区块的自定义 CSS（`styles.css`）与部分 JSX 内联类仍写死十六进制色值。终端使用 xterm，其主题在 `prototype-terminal.ts` 静态定义。

约束：
- `prototype-tailwind.css` 是已提交的编译产物，仓库未配置 Tailwind 编译步骤，不能靠新增工具类再编译。
- Renderer 不得直接访问 Node API、PTY、设置文件或系统外观 API；一切经受限 preload API（AGENTS.md 架构边界，ADR-0013 单用户本地边界）。
- 通用设置已有 `general.json` + `GeneralSettingsController` + `api.general` 通道，`apply` 回调目前只处理探针回显。
- 规格要求见 `specs/theme-customization/` 与 `specs/settings-workspace/`。

## Goals / Non-Goals

**Goals:**
- 三种主题模式（浅色 / 深色 / 跟随系统，默认跟随系统）与自定义核心配色（背景 / 前景 / 强调色）的完整链路：持久化 → 应用 → 实时生效 → 重启恢复。
- 覆盖桌面 UI 与 xterm 终端表面。
- 保持 Renderer 仅经受限 API 获取主题状态，Main 是主题事实源。

**Non-Goals:**
- 完整调色板（非核心色如边框、次色、危险色不可被用户自定义，随内置主题变化）。
- 主题导入/导出、多套自定义主题管理、第三方主题。
- 针对每个状态色（绿/琥珀/红）的自定义。

## Decisions

### D1. 主题设置并入通用设置（general.json），不新建 store

`GeneralSettings` 新增 `themeMode` 与 `customTheme` 两个字段，沿用 `api.general.getSettings/updateSettings` 通道。理由：主题属于"通用/外观"设置，复用既有持久化、sanitize、`apply` 生命周期与 IPC 通道，改动最小；不引入第二个设置文件与第二套 IPC。

`customTheme` 结构（含 `enabled` 开关 + 三色，颜色为六位十六进制字符串），sanitize 白名单校验，损坏字段回退默认。
_替代方案被否_：独立 `theme.json` + `api.theme` 读写——职责上主题确实是通用设置的一部分，双通道徒增复杂度。

### D2. 应用职责分主/渲染：Main 管系统外观，Renderer 管 CSS 与 xterm

Main 在 `apply` 回调中：`nativeTheme.themeSource = themeMode` → 依据 `nativeTheme.shouldUseDarkColors` 计算有效 scheme → 同步窗口背景色（`window.setBackgroundColor`）→ 广播 `theme:changed`（负载为 `ThemeState`）。同时监听 `nativeTheme.on('updated')`，在 `system` 模式下系统外观变化时重新广播。
Renderer 收到 `ThemeState`（`mode` + `scheme` + `customTheme`）后，由主题引擎把 CSS 变量写入文档根节点，并把 xterm 配色写入终端实例。
_替代方案被否_：Renderer 自行监听 `prefers-color-scheme` 媒体查询——Main 已是 `nativeTheme` 的事实源，双源易漂移；统一由 Main 广播可复用现有 IPC 事件机制。

### D3. 渲染端用内联 CSS 变量覆盖，避免改动已编译的 Tailwind 产物

主题引擎定义两套完整基础调色板（浅色 / 深色），把每条 CSS 变量（`--background`、`--foreground`、`--primary`、`--muted`、`--border`、`--card`、`--popover`、`--ring` 等）通过 `document.documentElement.style.setProperty` 写入。内联样式优先级最高，可稳定覆盖 `:root` 规则，且不需要 Tailwind 编译步骤。
自定义核心配色在基础调色板上做覆盖：`background → --background/--card/--popover/--terminal-bg`，`foreground → --foreground/--primary-foreground 等`，`accent → --primary/--ring`。语义色（状态点绿/琥珀/红、警告横幅）不参与覆盖。

### D4. 主要表面硬编码色改为 CSS 变量，语义装饰保持原样

`app.tsx` 工作区外壳/Header/品牌渐变/终端面板/搜索框，以及 `new-session-modal`、设置与 MCP 区块的底色与文字色，改用 CSS 变量（或 `var(--…)` 内联）；`styles.css` 中自定义组件（会话标签、右键菜单、对话框、设置卡片）的表层色与文字色同步变量化。状态点、琥珀横幅等语义装饰色保留字面值，深浅主题下均可读。
_边界_：本次只变量化"表面/文字"色；`prototype-tailwind.css` 中已存在的工具类映射（`text-foreground` 等）天然跟随变量，无需改动。

### D5. xterm 主题随 ThemeState 重建

`prototype-terminal.ts` 的静态主题改为从主题引擎取色的函数；`TerminalView` 接收 `xtermTheme` prop，在主题变化时更新 `terminal.options.theme`，并在 `app.tsx` 中随 ThemeState 传递。终端背景与前景跟随主题（自定义配色时用自定义背景/前景）。

### D6. 契约与 IPC

`shared/contracts.ts` 新增 `ThemeMode`、`CustomThemePalette`、`ThemeState` 类型；`GeneralSettings` 增加 `themeMode` 与 `customTheme`。`DESKTOP_IPC_EVENT_CHANNELS` 增加 `theme:changed`；preload 新增 `api.theme.getState()`（Main 计算当前 `ThemeState` 返回）与 `api.theme.onChanged()`。`settings:update-general` IPC 处理器放宽 patch 类型以接收主题字段，仍由 store sanitize 兜底。

### D7. Mock 模式提供默认主题状态

`mock-api.ts` 的 `general` 设置补上主题字段，`theme` API 返回默认 `ThemeState`（`system` + `dark` + 关闭自定义），便于 `pnpm dev` 下预览设置区块；`onChanged` 在 mock 下为空订阅。

## Risks / Trade-offs

- [styles.css 变量化覆盖面大、易漏] → 只变量化表面/文字色，用 `pnpm verify` + 浅色主题人工检查兜底；漏掉的非关键装饰在可接受范围内。
- [浅色主题下某些深色装饰观感不佳] → 语义色（状态点/横幅）在两套主题下均可读，属预期取舍，不在本次范围。
- [`nativeTheme.on('updated')` 在显式 light/dark 下也触发，造成重复广播] → 广播幂等（Renderer 收到相同状态直接重写变量），无副作用。
- [xterm 实例重开与主题更新竞态] → `TerminalView` 在主题变化时只改 `terminal.options.theme`，不重建实例，避免输出丢失。

## Migration Plan

纯新增能力：`general.json` 新增字段由 sanitize 兜底，旧文件可无缝读取（缺字段回退默认）。回滚＝移除主题字段与 `nativeTheme` 应用逻辑，界面回到硬编码深色，不影响终端核心。

## Open Questions

无——范围与决策已在用户确认的"核心配色"粒度内闭合。
