## 1. Session Alias 与 Core 契约

- [x] 1.1 先为默认 Alias、空白名称回退、重复 Alias、`sessionId` 不变和创建顺序编写失败测试，覆盖 Renderer helper 与 Core handler 边界。
- [x] 1.2 扩展 `SessionLaunchMetadata`/Session 列表所需的创建顺序元数据，并为旧记录定义插入顺序回退；补充 `core-schema` 自动 migration 和 repositories 往返测试。
- [x] 1.3 在 `packages/protocol/src/core-api/core-api.ts`、Core request router 和桌面 IPC channel 中加入 `session.rename` / `sessions:rename` 的严格输入与返回契约，输入只允许 `sessionId` 和非空 Alias。
- [x] 1.4 在 `packages/application/src/router/handlers/session-handler.ts` 与 `packages/infrastructure/src/store/repositories.ts` 实现重命名持久化、按 `createdAt` 排序、`session.changed` 广播和重命名审计；确认共享标记及 MCP 的 `sessionId` 行为不变。
- [x] 1.5 更新 `apps/desktop/src/preload/preload-api.ts`、`preload.ts` 和 mock API，暴露窄的 `sessions.rename`；为 IPC bridge、schema 和现有 `sessions:mark-shared` 回归补充测试。

## 2. Session 标签与创建交互

- [x] 2.1 为 `getDefaultSessionAlias` 和终端可用性状态点映射编写单元测试，覆盖 `终端 N` 最小未占用编号、PTY/Shell 组合状态和 Agent active turn 不影响颜色。
- [x] 2.2 改造 `renderer/sessions/new-session-modal.tsx` 和创建流程：打开时预填默认 Alias，提交空白值时回退默认值，并保留 Shell 选择与错误状态。
- [x] 2.3 重构 `apps/desktop/src/renderer/app.tsx` 的 Session tab markup，使标签按 Core 创建顺序显示，标签列表单行横向滚动，`+`、全部会话和共享 ID 位于滚动区右侧；同步更新 `all-sessions-popover.tsx` 使用 Alias 搜索和展示。
- [x] 2.4 实现标签上下文重命名菜单，接入 `sessions.rename`、pending/error 状态和重复 Alias；对运行中 PTY 或活动任务复用 `ConfirmDialog` 保护关闭操作。
- [x] 2.5 将共享动作固定到标签组右侧，复用 `sessions.markShared` 后复制返回的唯一 `id`，宽窄窗口分别显示图标/文字，补齐 tooltip、成功与失败反馈；标签内部移除复制按钮。
- [x] 2.6 在 `renderer/styles.css` 中实现约 `128px` 至 `224px` 的内容驱动标签宽度、激活底线、状态点、Shell 低强调文字、hover/focus 才出现的关闭按钮和窄窗口媒体规则。
- [x] 2.7 为多标签直接切换、水平滚动、默认名称、重命名、运行中关闭确认、共享 ID 和响应式固定操作补充 `apps/desktop/e2e/session-tabs.spec.ts` 与组件测试。

## 3. Agent 面板与时间线

- [x] 3.1 重构 `app.tsx` Agent 面板：移除 `agentTab`、顶部标题栏、内置 Agent 就绪条和 Timeline/Audit Tab，不渲染独立 plan/progress 卡片或槽位，并保持按 Session 隔离。
- [x] 3.2 将 `RuntimeAudit` 接入设置页只读视图，移除工作区内审计列表状态和加载路径，保留 `api.audit.list` 的过滤、格式化和清理边界。
- [x] 3.3 隐藏桌面内置/外置 Agent driver 切换、ACP 启动提示和外置新任务入口；保留 ACP controller、preload API、历史和后端编译路径，并添加“不出现外置入口”的 Renderer 回归测试。
- [x] 3.4 调整 `runtime-timeline.tsx` 及 Tool/Approval 卡片：用户消息右对齐、Assistant 消息左对齐、去除双方头像，Tool、审批和系统项占满面板内容宽度，progress snapshot 不创建可见节点；确认 Assistant delta 仍合并为单一 timeline item。

## 4. 运行状态与 Composer 取消

- [x] 4.1 先为 Composer action reducer 编写失败测试，覆盖空闲发送、运行中停止、取消中加载禁用、空输入仍可停止和重复点击抑制。
- [x] 4.2 调整 `running-status-bar.tsx` 只显示运行态、模型和持续时长，并将其紧贴 Composer 上方；移除状态栏和 Composer 左侧的重复取消主按钮。
- [x] 4.3 在 `app.tsx` 将发送按钮改为状态派生的发送/停止按钮：空闲提交目标，运行中调用当前内置 Agent cancel，取消请求中显示 Loader 和“取消中…”并禁用。
- [x] 4.4 覆盖审批等待、environment Probe、Provider 输出、Tool Result 等 blocking state 的取消行为，确认取消仍不自动中断正在运行的命令，并补充 pending/error 回归测试。

## 5. 视觉、可访问性与交互验证

- [x] 5.1 统一标签、Agent 面板、时间线和 Composer 的 CSS 层级与固定尺寸，移除标题/就绪/plan 卡片样式，检查文本 ellipsis、按钮内容、状态点颜色、右键菜单和图标 tooltip 不发生溢出或重叠。
- [x] 5.2 更新工作区 Playwright 场景，覆盖宽屏和窄桌面视口的无标题 Agent 面板、无 driver 就绪条和 progress/plan 卡片、用户/Assistant 对齐、运行状态栏位置和发送/停止状态。
- [x] 5.3 增加审计设置入口与 MCP 共享 ID 的端到端检查，确认审计不出现在 Agent 顶部 Tab，MCP 仍只能使用复制的唯一 `sessionId`。

## 6. 完整回归与交付检查

- [x] 6.1 按仓库脚本运行相关 package 的单元测试、类型检查、lint 和 IPC 契约测试，修复与本 change 相关的回归。
- [x] 6.2 运行桌面工作区和真实/打包环境 Playwright 测试，确认 UI 断连、Session 切换、Core 事件恢复、审批和取消行为未被破坏。
- [x] 6.3 记录宽窄视口视觉检查结果，确认 OpenSpec delta 的每条场景都有测试或可复现的手工验收证据后再标记任务完成。

验收记录：`1440x900` 与 `980x640` 均不显示 Agent 标题栏、内置 Agent 就绪条、progress/plan 卡片或 `Synapse · 任务进展`，文档宽度无溢出，运行状态栏直接位于 Composer 上方；Vitest `817 passed, 13 skipped`，Playwright `43 passed, 4 skipped`（Windows-only 场景按平台跳过），typecheck、lint、format check 和 OpenSpec strict 校验均通过。
