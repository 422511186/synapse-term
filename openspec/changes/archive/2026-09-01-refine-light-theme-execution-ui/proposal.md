## Why

当前浅色主题下，外部执行状态条幅、审批卡片和设置工作区混用了深色主题的硬编码颜色，部分文字与背景对比度不足；长命令还会因条幅绝对定位覆盖终端输出。需要在不改变外部调用、审批模式和本地输入语义的前提下，统一视觉层级并让浅色主题具备可验证的可读性。

## What Changes

- 将终端顶部的外部执行状态条幅重构为占用实际布局空间的状态栏，避免长命令覆盖 Terminal Session 输出；保留命令全文语义、来源标识、本地输入可用和执行期间持续显示。
- 重新设计审批卡片的标题、目标 Session、风险分类、命令全文、风险理由和操作区层级；保留允许一次、会话内放行该命令、拒绝三个动作及现有审批流程。
- 建立按浅色/深色 scheme 区分的语义颜色令牌，替换执行状态、审批状态、设置控件、提示、危险操作和选中态中的主题不安全硬编码颜色。
- 优化设置工作区的文字层级、控件状态、卡片边界和响应式布局，使通用、外观和 MCP 服务区块在浅色主题下保持清晰。
- 为自定义核心配色增加可读性反馈或安全回退策略，避免自定义背景与前景组合产生不可读的界面文字。
- 增加浅色/深色主题下的组件回归测试、对比度检查和包含长命令的视觉验收场景。

## Capabilities

### New Capabilities

<!-- 本变更不引入新的领域能力。 -->

### Modified Capabilities

- `mcp-access`: 调整外部执行状态展示和审批卡片的视觉要求；不改变外部调用、审批模式、会话内放行、输出脱敏或本地输入语义。
- `settings-workspace`: 增加设置工作区在浅色/深色 scheme 下的可读性、状态层级和响应式展示要求。
- `theme-customization`: 增加主题语义令牌、界面文字对比度和自定义核心配色可读性保障要求。

## Impact

- 主要影响 `apps/desktop/src/renderer/app.tsx`、`mcp/approval-card.tsx`、`mcp/mcp-settings-section.tsx`、`settings/settings-workspace.tsx`、`theme/theme-palette.ts`、`theme/theme-settings-view.tsx` 和 `styles.css`。
- 可能新增 Renderer 侧颜色对比度辅助函数和组件测试；不新增运行时依赖，不改变 Electron Main、preload、MCP HTTP 端点或终端服务协议。
- 需要更新 Renderer 单测及 Playwright/截图验收，覆盖浅色主题、深色主题、超长命令、审批动作、设置区块和本地键盘输入保持可用。
