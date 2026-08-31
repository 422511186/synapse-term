## 1. 领域类型与契约

- [x] 1.1 在 `apps/desktop/src/shared/contracts.ts` 新增 `TerminalTextPalette`（16 个 ANSI 颜色字段）并扩展 `CustomThemePalette` 增加可选 `terminalText`；验证 `tsc` 类型检查通过
- [x] 1.2 更新 `apps/desktop/src/shared/desktop-ipc-contract.test.ts`（如有契约快照）以覆盖新增字段；验证该测试通过

## 2. 主题解析与终端色板

- [x] 2.1 在 `apps/desktop/src/renderer/theme/theme-palette.ts` 定义 `SCHEME_ANSI_PALETTES`（浅色/深色各 16 色）并让 `buildXtermTheme` 按「custom 启用且 terminalText 存在 → 自定义；否则 scheme 色板」解析；验证 `theme-palette.test.ts` 覆盖双 scheme 与自定义覆盖
- [x] 2.2 新增「恢复默认」逻辑（terminalText 置为 undefined 回退 scheme 色板）；验证对应单元测试通过

## 3. 持久化与消毒

- [x] 3.1 扩展 `apps/desktop/src/main/settings/general-settings.ts` 的 `sanitizeCustomTheme`：terminalText 缺失 → undefined，存在 → 逐字段校验并回退深色默认；验证 `general-settings.test.ts` 覆盖缺失/非法/合法三种情况

## 4. 设置菜单分类导航

- [x] 4.1 重构 `apps/desktop/src/renderer/settings/settings-workspace.tsx`：左侧 `nav` 菜单（通用 / 外观 / MCP 服务）+ 右侧单面板，本地 `activeCategory` 状态，默认「通用」，当前项 `aria-current` 高亮；验证渲染与切换行为
- [x] 4.2 在 `styles.css` 新增侧栏导航样式（flex 布局、hover/active 高亮，使用主题变量）；验证浅色/深色下可读

## 5. 终端文字编辑 UI

- [x] 5.1 在 `apps/desktop/src/renderer/theme/theme-settings-view.tsx` 新增「终端文字配色」子区块：16 个 ANSI 颜色编辑器（文本 + 颜色选择器），仅 custom 启用时可编辑，首次编辑以当前 scheme 色板初始化完整 16 色；验证非法值拒绝
- [x] 5.2 新增「恢复默认」按钮（terminalText 存在时显示），点击清空 terminalText；验证 UI 交互与回退行为

## 6. 测试更新

- [x] 6.1 更新 `apps/desktop/e2e/workspace.spec.ts`：设置打开后先点击「外观」分类再断言主题区块；新增用例验证浅色/深色切换时终端 ANSI 变化与自定义终端文字生效；验证 `pnpm test:e2e -g theme` 通过
- [x] 6.2 检查并更新 `apps/desktop/src/renderer/mock-api.test.ts` 与 `mock-api.ts`（如含主题默认状态）；验证相关单测通过

## 7. 验证与归档

- [x] 7.1 运行 `pnpm verify` 全绿（format/lint/typecheck/单测）
- [x] 7.2 运行 `pnpm test:e2e` 全绿（含主题与设置菜单用例）
- [x] 7.3 归档变更并同步主规格（`openspec archive`，同步 theme-customization 与 settings-workspace）
