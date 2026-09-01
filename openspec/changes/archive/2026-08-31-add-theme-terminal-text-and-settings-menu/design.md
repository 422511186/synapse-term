## Context

背景动机见 [proposal.md](./proposal.md)。现状：

- `ThemeState.customTheme` 仅含 `enabled/background/foreground/accent`，终端 ANSI 16 色在所有主题间共享同一套（`ANSI_THEME_COLORS`），且只定义了 12 个字段（bright 红绿黄蓝品红青缺失，依赖 xterm 回退）。
- 设置工作区（[settings-workspace.tsx](../../apps/desktop/src/renderer/settings/settings-workspace.tsx)）在单个纵向滚动 `main` 中堆叠「通用 / 外观 / MCP 服务」三张卡片。
- `general.json` 的消毒逻辑位于 [general-settings.ts](../../apps/desktop/src/main/settings/general-settings.ts)，新增字段必须在此补默认值与非法值回退。

## Goals / Non-Goals

**Goals:**

- 终端文字（ANSI 16 色）随浅色/深色 scheme 切换，内置两套适配色板。
- 自定义主题可编辑终端文字 16 个 ANSI 颜色；未定制时回退到当前 scheme 的内置色板（保持自适应）。
- 设置工作区改为左侧分类导航（通用 / 外观 / MCP 服务），一次只显示一个分类面板。
- 新增字段随 `general.json` 持久化，非法值被拒绝并保留原值。

**Non-Goals:**

- 不引入主题文件导入/导出、主题市场或第三方主题源。
- 不新增设置项分类粒度（不把外观再拆成多个子分类）。
- 不改动终端渲染引擎（xterm.js），仅更新其 theme 配置。

## Decisions

### 1. 自定义调色板扩展为「核心色 + 可选终端文字色」

`CustomThemePalette` 保持扁平结构，新增可选 `terminalText?: TerminalTextPalette`；`TerminalTextPalette` 定义 16 个 ANSI 颜色字段（black/red/green/yellow/blue/magenta/cyan/white 及其 bright 变体）。

- **为什么可选（undefined 即未定制）**：持久化值无法区分「用户显式设置的 16 色」与「初始化时从某 scheme 拷贝的默认值」。可选字段让「未定制 → 跟随 scheme 内置色板」成为可能，避免浅色模式下残留深色 ANSI 色板。
- **替代方案**：`terminalText` 始终存在、默认值为深色 ANSI。缺点是启用自定义后用户若不手动调整，浅色模式下终端文字观感与背景割裂；且无法表达「恢复跟随 scheme」。否决。
- **恢复手段**：UI 提供「恢复默认」按钮，将 `terminalText` 置为 `undefined` 回退 scheme 色板。

### 2. 内置 scheme 终端文字色板

在 [theme-palette.ts](../../apps/desktop/src/renderer/theme/theme-palette.ts) 中定义 `SCHEME_ANSI_PALETTES: Record<ThemeScheme, TerminalTextPalette>`：

- 深色：延续现有 ANSI 值并补齐 6 个缺失的 bright 字段。
- 浅色：选用在白底上可读的深色调（如 red `#dc2626`、blue `#2563eb`、white `#52525b`），bright 变体为对应亮色。

`buildXtermTheme` 解析顺序：

1. 背景/前景/光标/选中色沿用现有逻辑（custom 启用取自定义值，否则取 scheme 值）。
2. ANSI 16 色：custom 启用且 `custom.terminalText` 存在 → 用其值；否则用 `SCHEME_ANSI_PALETTES[scheme]`。

### 3. 设置左侧分类导航

重构 [settings-workspace.tsx](../../apps/desktop/src/renderer/settings/settings-workspace.tsx)：

- `main` 内改为横向布局：左侧 `<nav class="settings-nav">` 菜单 + 右侧单个内容面板。
- 本地状态 `activeCategory: 'general' | 'appearance' | 'mcp'`，默认 `general`；点击菜单项切换面板并高亮（`aria-current="page"` + `.is-active`）。
- 分类映射：通用 → `GeneralSettingsView`；外观 → `ThemeSettingsView`；MCP 服务 → `McpSettingsView`。
- 加载状态（`settings === undefined`）仍渲染整页 loading。
- 样式复用现有 `mcp-settings-card` 区块外观；新增侧栏样式（flex 布局、hover/active 高亮），随主题变量取色。

**替代方案**：顶部 Tab。因分类会继续扩展、且左侧导航更贴近桌面端设置惯例，选左侧导航。

### 4. 终端文字编辑 UI

`ThemeSettingsView` 在「自定义核心配色」之后新增「终端文字配色」子区块：

- 列出 16 个 ANSI 颜色，每个为 名称 + 文本输入 + 颜色选择器，复用现有 `theme-color-row` 交互与非法值拒绝逻辑。
- 仅当 `customTheme.enabled` 时可用。
- 「恢复默认」按钮：`terminalText` 存在时显示，点击后置为 `undefined`。
- 用户首次编辑任一 ANSI 颜色时，以当前 scheme 的 `SCHEME_ANSI_PALETTES` 为基底初始化整个 `terminalText` 再更新该字段，保证持久化的是完整 16 色。

### 5. 持久化与消毒

[general-settings.ts](../../apps/desktop/src/main/settings/general-settings.ts) 的 `sanitizeCustomTheme` 扩展：

- `terminalText` 缺失或非对象 → 保持 `undefined`。
- 存在 → 逐字段用 `HEX_COLOR_PATTERN` 校验，非法字段回退为深色 scheme 对应默认值。
- `DEFAULT_CUSTOM_THEME` 不新增 terminalText（保持未定制）。

### 6. 测试更新

- 单元测试：`theme-palette.test.ts` 覆盖双 scheme ANSI、自定义 terminalText 覆盖、恢复默认；`general-settings.test.ts` 覆盖 terminalText 消毒（缺失/非法/合法）。
- E2E：`workspace.spec.ts` 打开设置后需先点击「外观」分类；新增用例验证浅色/深色切换时终端 ANSI 变化与自定义终端文字生效。

## Risks / Trade-offs

- **可选字段与 `updateSettings` 部分更新**：渲染进程发送完整 `customTheme` 对象，`terminalText: undefined` 不会写入 JSON（`JSON.stringify` 忽略 undefined），Main 消毒后保持未定制 → 符合预期。需在 controller 层确认 patch 合并语义不被破坏。
- **深色/浅色 ANSI 观感**：浅色色板为人工选取的近似值，可能与个别命令输出对比度不理想 → 通过 E2E 抽查默认文本色与亮色变体。
- **设置页 E2E 依赖默认分类**：既有测试直接断言主题/MCP 区块可见，改造后需先切换分类；将同步更新测试以避免假绿。
