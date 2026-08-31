## Why

当前终端文字（ANSI 16 色）在所有主题之间共享同一套色板，切换浅色/深色或启用自定义主题后，终端文字不会随之变化，与桌面 UI 的主题观感割裂。同时设置工作区将「通用 / 外观 / MCP」等区块纵向堆叠在单页中，分类不清晰、难以扩展。

## What Changes

- **终端文字随主题变化**：为浅色、深色内置主题分别定义适配各自背景的 ANSI 16 色板；切换主题时终端文字（前景与 ANSI 颜色）随之变化。
- **自定义终端文字配色**：启用自定义主题后，除背景/前景/强调色外，可进一步编辑终端文字前景与 16 个 ANSI 颜色（黑/红/绿/黄/蓝/品红/青/白及其亮色）。
- **设置菜单分类导航**：设置工作区改为左侧分类导航（通用、外观、终端、MCP 服务），点击菜单项切换右侧单一面板；保留返回工作区入口与品牌外观。
- **持久化与消毒**：新增终端文字字段随通用设置持久化，非法颜色在持久化时被拒绝并保留原值，设置文件损坏时回退默认值。

## Capabilities

### New Capabilities

无新增能力。

### Modified Capabilities

- `theme-customization`：终端文字 ANSI 色板随主题（浅色/深色/自定义）变化；自定义主题新增终端文字颜色编辑。
- `settings-workspace`：设置工作区由纵向堆叠改为左侧分类菜单导航，各配置区块归入对应菜单分类。

## Impact

- `apps/desktop/src/shared/contracts.ts`：`CustomThemePalette` 扩展终端文字字段。
- `apps/desktop/src/renderer/theme/theme-palette.ts`：按 scheme 提供独立 ANSI 色板；`buildXtermTheme` 应用自定义终端文字。
- `apps/desktop/src/renderer/theme/theme-settings-view.tsx`：新增终端文字颜色编辑区块。
- `apps/desktop/src/renderer/settings/settings-workspace.tsx` 及样式：左侧分类导航与面板切换。
- `apps/desktop/src/main/settings/general-settings.ts`：新增字段的消毒与默认值。
- 单元测试与 E2E：`theme-palette.test.ts`、`general-settings.test.ts`、`workspace.spec.ts` 等。
