## Context

桌面端 Renderer 的交互反馈目前是碎片化实现：模型列表用 `pendingId` 只做按钮变灰（`model-settings.tsx`），模型编辑弹窗用 `testing`/`saving` 只改文字（`model-edit-modal.tsx`），MCP/ACP 设置页用 `busy` 只禁用控件（`mcp-settings-view.tsx`、`acp-settings-view.tsx`），Agent 运行状态只靠发送按钮文字与时间线卡片被动呈现（`app.tsx`、`runtime-timeline.tsx`）。成功反馈普遍缺失，错误要么内联在页面顶部、要么走阻塞式 `runtime-error-dialog`。约束：这是纯 Renderer UI 层改动，不改变 IPC 契约、协议或后端行为，且需要兼容现有组件测试与 Playwright 场景。

## Goals / Non-Goals

**Goals:**
- 建立三种反馈原语并统一所有交互：瞬时动作（乐观更新）、有界异步动作（进行中/成功/失败三态）、无界运行状态（常驻指示器）。
- 为所有操作按钮提供防连点/防抖保护：首次点击立即生效，in-flight 期间忽略后续点击。
- 引入 toast 轻提示与统一确认对话框，让成功、失败、破坏性操作都有明确反馈。
- Agent 面板具备运行状态条、"思考中…"占位与外部 Agent 启动阶段提示。

**Non-Goals:**
- 不改变任何 Core/IPC/协议行为，不修改 `preload-api.ts` 的契约。
- 不重设计现有原型视觉体系，沿用当前 Tailwind 风格与组件结构。
- 不引入新的外部依赖。
- 不覆盖移动端或终端交互本身。

## Decisions

**D1：反馈分层为三种原语。**
瞬时动作（启用/停用模型、设为默认、切换方言/权限）走乐观更新 + toast，不加 spinner——本地 DB 写入通常在几十毫秒内完成，spinner 反而制造"卡顿感"。有界异步动作（检测模型、拉取远程模型、测试连接、删除、MCP/ACP 开关）走按钮三态：待命 → spinner+进行中文案 → 成功态/toast 或错误 toast。无界运行状态（Agent 运行中、服务启动/停止中）走常驻指示器，不依赖按钮文字。

**D2：防连点采用 leading-edge lock，而非 trailing debounce。**
首次点击立即触发；请求未 settle 前忽略同一控件的后续点击；快速切换类操作（启用/停用、审批模式）额外允许一个不超过 500ms 的冷却窗口，防止状态来回抖动。Trailing debounce 会延迟操作并造成"点了没反应"的错觉，不适合按钮类交互；in-flight lock 既防重复请求又保持即时响应。

**D3：新增 Renderer 本地 `feedback` 模块。**
在 `apps/desktop/src/renderer/feedback/` 提供 `ToastProvider`/`useToast`、`useAsyncAction`、`PendingButton`、`ConfirmDialog`。理由：这些原语强绑定桌面 Renderer 的交互模式，且当前 `ui-platform` 承载终端/原型共享组件，边界不清；后续若 CLI 或其他宿主需要可再上移。所有页面替换掉散落的 `pendingId`/`busy`/`testing`/`saving`/`creating` 状态。

**D4：快操作乐观更新，失败回滚。**
启用/停用模型与设为默认：点击后立即翻转 UI 状态并 toast 确认；IPC 失败时回滚到前值并 toast 错误。同控件的 in-flight guard 保证同一时刻只有一个未 settle 的请求，避免回滚覆盖更新的状态。

**D5：慢操作统一三态，成功反馈必须可见。**
检测模型成功后按钮短暂显示"检测通过"+ 耗时（如 `✓ 检测通过 · 1.2s`），并 toast；失败 toast 展示分类原因（401/模型不存在/连接拒绝）。编辑弹窗中新建模型也可检测：点击"检测模型"先保存草稿再调用 `models.test()`，与 Provider"测试连接"的既有语义一致，失败时保留弹窗。

**D6：错误反馈分级。**
配置类操作错误（检测失败、保存失败、开关失败）走 toast，不再内联在页面顶部或阻塞弹窗；Agent 运行时错误保留现有 `runtime-error-dialog`，因为它承载"取消当前任务"的醒目入口，且 `desktop-terminal` spec 要求不得阻塞取消操作。

**D7：Agent 运行状态由现有状态派生，不新增 IPC。**
运行状态条显示"Agent 运行中 · 当前模型 · 已运行时长"与取消任务按钮，由 `activeTurn`（含 `startingTurn`、内置 `activeTurnId`、ACP `acpActiveTurnIds`）派生；耗时用秒级 `setInterval` 在 activeTurn 期间更新。"思考中…"占位在"activeTurn 为真且自用户消息后无新 timeline 事件"时显示，第一条事件到达即移除。ACP 首次启动阶段（spawn → 握手 → 新会话）由 `startTurn` promise 期间的 `startingTurn` 驱动，显示"正在启动外部 Agent（opencode）…"，握手完成后由现有 `system` 事件"外部驱动者已就绪"自然衔接。

**D8：破坏性操作统一确认对话框。**
删除模型/Provider、吊销 token、清空会话、退出 Core 等使用统一 `ConfirmDialog` 替换 `window.confirm`；确认按钮同样进入 pending 态并防连点，防止双击提交。

## Risks / Trade-offs

- [乐观更新回滚竞态] → 同一控件 in-flight guard 串行化请求；同一模型行共享一个 pending 状态，跨按钮也不并发。
- [toast 堆积或重复] → 并发上限 3 条，同类消息合并更新；成功 toast 3 秒自动消失，错误 toast 手动关闭。
- [防连点过度限制真实意图] → 冷却窗口仅覆盖 in-flight + 最多 500ms；切换类操作完成后立即恢复可点。
- [状态条秒级定时器开销] → 仅在 `activeTurn` 为真时运行 interval，组件卸载与 turn 结束时清理。
- [新建模型检测隐含保存草稿] → 与 Provider"测试连接"语义一致，弹窗内以文案说明"测试前会保存草稿"。
- [大面积替换引入回归] → 按页面分批替换，每批跑组件测试与 Playwright 场景，纯 UI 改动可随时单独 revert。

## Migration Plan

阶段一：搭建 `feedback` 基建（ToastProvider、useAsyncAction、PendingButton、ConfirmDialog），替换模型配置页与模型/Provider 编辑弹窗。
阶段二：Agent 面板（运行状态条、"思考中…"占位、ACP 启动提示、审批/取消按钮 pending）与 MCP/ACP 设置页开关三态。
阶段三：全局排查剩余 `window.confirm`、`busy`/`pending` 散落点，补防连点与 toast，跑完整验证矩阵。

无数据迁移；回滚策略为逐阶段 revert UI 提交。

## Open Questions

- toast 位置与并发上限按推荐定为右下角、最多 3 条，实现时可按视觉微调。
- 运行状态条位置按推荐放在 Agent 面板顶部（驱动者切换行下方），与取消任务入口同排。
