## Why

关闭终端会话等破坏性操作使用的 `ConfirmDialog` 把面板、页眉和页脚背景写死为深色（`#18181b`、`#09090b`），文字却使用跟随当前主题的 `--foreground`/`--muted-foreground`。有效 scheme 为浅色或启用浅色自定义配色时，弹窗呈现深色面板配深色文字，正文与按钮几乎不可读；这与现有 theme-customization 的“桌面 UI 必须按当前有效 scheme 使用语义颜色并保持可读”约束冲突。

## What Changes

- 将 `apps/desktop/src/renderer/feedback/confirm-dialog.tsx` 中的硬编码深色背景改为当前主题语义表面：面板使用 `bg-popover`/`text-popover-foreground`，页眉与页脚使用与当前 scheme 匹配的配对前景/背景，取消按钮的悬停与分隔线继续使用语义边框。
- 保持现有 `ConfirmDialog` 的 props、pending 态、防连点、`aria` 语义与调用点不变，不修改 IPC 契约或任何非 UI 行为。
- 补充浅色/深色主题下的回归验证，确认关闭单会话、关闭全部、关闭左右范围三种弹窗在两种 scheme 下文字对比度满足可读要求。

## Capabilities

### New Capabilities

<!-- 本次不引入新能力。 -->

### Modified Capabilities

- `interaction-feedback`: 明确“破坏性操作确认对话框”必须使用当前有效 scheme 的语义表面与文字配对，不得依赖只在深色主题下可读的硬编码颜色。

## Impact

- 受影响代码：`apps/desktop/src/renderer/feedback/confirm-dialog.tsx` 及其组件测试；调用点 `apps/desktop/src/renderer/app.tsx` 不需改动。
- 不涉及协议、preload API、Session/PTY 生命周期或领域模型。
- 需要验证桌面端深色与浅色主题下“关闭终端会话／全部关闭／关闭左右范围”三种确认弹窗的样式回归；自定义主题开启低对比度组合时仍沿用现有安全回退颜色机制。
