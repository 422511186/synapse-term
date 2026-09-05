## Context

`ConfirmDialog` 通过 portal 挂载到 `document.body`，背景色在 [confirm-dialog.tsx](/Users/huangzy/.codex/worktrees/901f/synapse-term/apps/desktop/src/renderer/feedback/confirm-dialog.tsx) 中写死为深色 `#18181b`/`#09090b`，文字颜色则来自 Tailwind 预置的 `body { color: var(--foreground) }`。浅色 scheme 下 `--foreground` 为深色，形成深色面板配深色文字。主题系统已经提供 `--background`、`--popover` 等语义变量，其它 Tailwind 弹窗（如新建会话）已使用这些 token；问题只发生在该组件遗漏迁移。

## Goals / Non-Goals

**Goals:**

- 让确认对话框在浅色与深色 scheme 下都使用与背景配对的语义文字颜色。
- 保持现有组件 props、pending 态、防连点、`aria` 语义与调用点不变。

**Non-Goals:**

- 不调整主题调色板、自定义主题对比度算法或其它弹窗组件。
- 不修改 IPC 契约、preload API、Session/PTY 生命周期或领域模型。

## Decisions

**D1：用语义 Tailwind token 替换硬编码背景色。**

面板由 `bg-[#18181b]` 改为 `bg-popover`，页眉/页脚由 `bg-[#09090b]` 改为 `bg-background`。这两个 token 在深色 scheme 下正是原来的两个十六进制值，因此深色外观不回归；浅色 scheme 下会自动落到白色表面，与 `--foreground` 深色文字配对。

备选：为该弹窗新增专用 CSS 类并引用 `--surface-dialog`/`--ui-text-*`。该方案更贴合部分自定义组件，但会偏离同批 Tailwind 弹窗（新建会话等）已建立的 token 用法，改动面更大，故不采用。

**D2：验证放在浏览器计算样式层，而不是组件 renderToString。**

`ConfirmDialog` 的现有单元测试只能验证渲染文本与 pending 态，无法计算 CSS。回归测试应通过 Playwright 在真实页面切换浅色主题、打开确认对话框，并读取 `role="alertdialog"` 内面板与文字的计算颜色做对比度断言。测试 seam 是用户可见的确认对话框计算样式。

## Risks / Trade-offs

- [自定义配色为低对比度组合时，Tailwind token 仍可能沿用用户设置值而非安全回退] → 该问题同时影响其它 Tailwind 弹窗，属于既有主题回退机制范围；本次修复保证内置浅色/深色 scheme 的可读性，不扩大自定义主题回退算法改动。
- [E2E 对具体颜色做断言可能随主题调色板调整而变脆] → 断言使用调色板中的已知十六进制值换算对比度，而不是只比较“非黑非白”，未来调色调整需同步更新场景。

## Migration Plan

纯 Renderer 样式修复，无数据或协议迁移；改动可随单次提交回退。
