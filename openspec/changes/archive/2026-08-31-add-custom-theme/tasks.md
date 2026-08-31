# Tasks: Add Custom Theme

## 1. 领域类型与持久化（shared + Main）

- [x] 1.1 在 `shared/contracts.ts` 新增 `ThemeMode`、`CustomThemePalette`、`ThemeState` 类型，并为 `GeneralSettings` 增加 `themeMode` 与 `customTheme` 字段，附 `desktop-ipc-contract.test.ts` 契约断言
- [x] 1.2 扩展 `main/settings/general-settings.ts`：默认值（`themeMode: 'system'`，`customTheme` 关闭）、六位十六进制颜色校验、`sanitizeGeneralSettings` 白名单与损坏回退，更新 `general-settings.test.ts` 覆盖默认值、合法值、非法颜色与缺失字段
- [x] 1.3 验证 `pnpm --filter @synapse-term/desktop typecheck` 通过

## 2. Main 应用与广播（electron-main / electron-window）

- [x] 2.1 在 `main/settings/general-settings-controller.ts` 保持通用 `apply` 语义；在 `electron-main.ts` 扩展 `apply` 回调：设置 `nativeTheme.themeSource`、依据 `shouldUseDarkColors` 计算 scheme、同步窗口背景色、广播 `theme:changed`（`ThemeState`），并注册 `nativeTheme.on('updated')` 在 `system` 模式下重新广播
- [x] 2.2 扩展 `electron-window.ts` 提供按 scheme 计算的窗口背景色 helper，并在 apply 时调用 `window.setBackgroundColor`
- [x] 2.3 更新 `main/settings/general-settings-controller.test.ts` 与相关单测，覆盖 apply 携带主题字段的场景

## 3. Preload / IPC 契约

- [x] 3.1 在 `shared/desktop-ipc-channels.ts` 的 `DESKTOP_IPC_EVENT_CHANNELS` 增加 `theme:changed`
- [x] 3.2 扩展 `preload/preload-api.ts`：新增 `api.theme.getState()` 与 `api.theme.onChanged()`，更新 `preload-api.test.ts`
- [x] 3.3 放宽 `settings:update-general` IPC 处理器 patch 类型以接收 `themeMode` / `customTheme`，仍由 store sanitize 兜底，更新 `electron-main` 相关测试

## 4. Renderer 主题引擎

- [x] 4.1 新增 `renderer/theme/theme-palette.ts`：内置浅色/深色两套完整 CSS 变量调色板、自定义核心配色覆盖函数、`applyThemeToDocument(ThemeState)` 写入文档根节点，附 `theme-palette.test.ts`（两套基础值、自定义覆盖、背景/前景/强调映射、空值回退）
- [x] 4.2 新增 xterm 主题构建函数（由 ThemeState 计算背景/前景/选区等），并导出 `prototype-terminal.ts` 复用
- [x] 4.3 在 `app.tsx` 接入 `api.theme.getState()` + `api.theme.onChanged()`：应用 CSS 变量、设置 `data-theme` 属性、把 xterm 主题传给 `TerminalView`，附渲染/逻辑单测

## 5. 表面变量化与终端主题

- [x] 5.1 将 `app.tsx` 外壳、Header、品牌渐变、终端面板、搜索框的硬编码色改为主题 CSS 变量；`new-session-modal.tsx` 与设置/MCP 区块表面色同步变量化
- [x] 5.2 将 `styles.css` 中自定义组件（会话标签、右键菜单、对话框、设置卡片）的表面色与文字色改为 `var(--…)` 引用，语义装饰色（状态点/警告横幅）保留
- [x] 5.3 更新 `terminal-view.tsx` 接收并应用 xterm 主题（主题变化时更新 `terminal.options.theme` 不重建实例），补组件测试

## 6. 设置工作区主题区块

- [x] 6.1 新增 `renderer/theme/theme-settings-view.tsx`：模式三选一（浅色/深色/跟随系统）、自定义配色开关与背景/前景/强调三个颜色选择器，实时预览，经 `api.general.updateSettings` 提交，附组件测试（settings-workspace 渲染、非法颜色拒绝、开关回退）
- [x] 6.2 在 `settings-workspace.tsx` 挂载主题区块并接入 busy/loading 状态，更新 `settings-workspace.test.tsx`
- [x] 6.3 扩展 `mock-api.ts`：general 设置补主题字段、`api.theme` 返回默认 ThemeState 与空订阅，更新 `mock-api.test.ts`

## 7. 端到端验证与收尾

- [x] 7.1 补充 Playwright 场景：进入设置 → 切换主题模式与自定义配色 → 验证界面与终端配色变化、重启恢复（`apps/desktop/e2e/`）
- [x] 7.2 运行 `pnpm verify`（格式、ESLint、类型检查、Vitest）并修复发现的问题
- [x] 7.3 运行 `pnpm test:e2e`，确认既有终端与设置流程无回归
