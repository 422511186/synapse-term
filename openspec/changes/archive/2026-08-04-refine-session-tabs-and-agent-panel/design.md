## Context

当前桌面 Renderer 的工作区主要由 `apps/desktop/src/renderer/app.tsx` 统筹：它同时维护 Session 标签、`agentTab`、内置/ACP driver、运行态和 Composer。标签相关组件位于 `renderer/sessions/`，Agent 时间线和运行状态组件位于 `renderer/agent-panel/`，而审计数据已经通过 preload 的 `api.audit.list` 提供。

Core 当前用 `SessionSummary.title` 和 Session 元数据中的 `title` 作为展示名称，用 `id` 作为唯一 Session 身份；`sessions:mark-shared` 已实现“复制 ID 后共享”以及共享后的自动探测。Agent progress 已是有界的 `AgentProgressSnapshot`，通过 timeline item 投影到 Renderer。设计必须保留这些执行和安全边界，只调整桌面呈现和别名管理。

## Goals / Non-Goals

**Goals:**

- 让多个 Session 在宽、窄窗口中都能直接切换，并让新建、全部会话、共享 ID 等固定操作始终可达。
- 将 `SessionSummary.title` 的产品语义明确为 Session Alias，提供默认名称、回退和重命名，同时永远不把别名当作唯一身份。
- 将 Agent 面板整理为无额外标题栏的单一工作区：可滚动时间线、运行状态和 Composer 具有稳定的上下关系，不额外增加 plan 或 progress snapshot 卡片。
- 让取消操作只有一个主要入口：Composer 的发送按钮在 Agent 运行时切换为停止动作，并覆盖所有可取消的阻塞阶段。
- 将审计日志移出任务面板，复用现有 `api.audit.list` 在设置中提供只读查看，不改变审计事件、保留和安全规则。
- 暂时从桌面工作区隐藏 ACP/外置 Agent 的选择和启动入口，但保留 Core、preload 类型和后端进程能力，以便后续恢复。

**Non-Goals:**

- 不修改 MCP 的 `sessionId` 参数、Session 共享安全边界、Lease、审批策略或外部工具协议。
- 不重写内置 Agent 的推理循环、Tool Gateway、progress 生成规则或隐藏推理内容。
- 不删除 ACP 后端、数据库数据或已有协议；本 change 只控制当前桌面产品入口和可见投影。
- 不定义移动端布局，也不借此 change 引入新的视觉依赖或图标库。

## Decisions

### 1. 将现有 `title` 作为 Session Alias

Session Alias 是用户用于识别和切换的可读名称，`sessionId` 继续是唯一身份。为避免同时维护 `title`、`name`、`alias` 三个字段，协议和存储先保留现有 `title` 字段，把其文档和 UI 语义统一为 Alias；新增重命名请求只更新这个字段。这样既兼容现有数据库和历史 Session，又能明确 MCP 永远复制和使用 `id`。

新建弹窗打开时由 Renderer 根据当前 Session 列表计算最小未占用的 `终端 N` 并预填。提交时对空白输入再次使用同一个默认值；Core 仍对最终值做非空校验。重命名允许重复，不用别名做查找、路由或 MCP 授权键。

备选方案是新增 `alias` 列并迁移所有协议、存储和历史数据。它能让字段名更精确，但会扩大 IPC、数据库迁移和旧数据兼容范围，对本次纯工作区改造没有足够收益，因此暂不采用。

### 2. 将标签栏拆成可滚动列表和固定操作区

标签栏使用两个兄弟区域：左侧是单行、内容驱动宽度的横向滚动列表，右侧是不会被滚动挤走的 `+`、全部会话和共享 ID 操作。标签宽度限制在约 `128px` 到 `224px`，标题和 Shell 类型使用独立的可截断文本，关闭按钮只在当前、hover 或 keyboard focus 时出现。标签只显示终端可用性状态点，Agent 是否运行由 Agent 面板状态条负责。

状态点通过纯函数映射正交 Session 状态：失败为红色，退出/中断为灰色，Shell 就绪为绿色，启动、探测、执行和等待交互为黄色。激活态使用扁平深色背景和底部强调线，避免为每个标签增加复制按钮和边框型文字按钮。

标签创建顺序由 Core 持久化的 `createdAt` 元数据提供，`SessionSummary` 不需要把它暴露给用户。现有没有该字段的记录按数据库原有插入顺序回退，新建记录写入单调可比较的时间值；Core 返回列表时按该值排序，不能继续按随机 UUID 排序。

关闭操作继续走现有 ConfirmDialog：运行中的 PTY 或有活动任务时先确认，关闭后按已有 Session 选择策略切换到下一会话。右键或等价的标签上下文菜单只提供重命名等 Session 操作，不把 `sessionId` 暴露到标签正文。

### 3. 采用单列 Agent 面板布局

移除 `agentTab` 状态、面板顶部标题栏、内置 Agent 就绪条和 Timeline/Audit 二选一。Agent 面板直接放置可滚动时间线、运行状态栏和 Composer，不提供额外的面板标题或折叠块。progress snapshot 继续由运行时和历史状态管理，但 Renderer 过滤掉对应的可见时间线节点；Tool 与审批事件仍在时间线中显示，不再维护单独的 plan 槽位。审计页面从设置导航进入，沿用 `RuntimeAudit` 的只读展示与现有过滤 API。

内置 Agent 是当前唯一可从桌面启动的驱动者，因此移除面板中的内置/外置 segmented control 和 ACP 启动提示。ACP 控制器、preload API、历史数据和 Core 事件仍保留；如果后续重新开放，只需恢复桌面入口和对应投影，不需要改变会话或任务身份模型。

### 4. 使用消息对齐和全宽卡片建立视觉层级

时间线渲染器保留用户、Assistant、Tool、审批和 progress 的事件分组与稳定 ID，只改变布局：用户气泡靠右、Assistant 内容靠左，双方不渲染头像；Tool、审批和系统状态使用面板宽度的结构化卡片，progress snapshot 不创建可见卡片。Assistant delta 仍合并到一个稳定 item，不能因为视觉重排而创建重复消息。

### 5. 将运行态和取消动作合并到 Composer

运行状态栏紧贴 Composer 上方，显示运行中/启动中、模型和持续时长，但不再提供第二个取消按钮。Composer 发送按钮根据状态派生动作：空闲时提交非空目标，运行中变为停止图标和“停止”语义，取消请求进行中显示 Loader 并禁用。运行中即使输入框为空也必须允许停止；审批、Probe、Provider 输出、Tool Result 等 blocking state 统一调用现有 Agent cancel API，底层仍维持取消与命令中断分离。

### 6. 通过现有窄 IPC 保持可测试边界

Session 重命名新增 `sessions:rename` / `session.rename` 的窄通道，输入只包含 `sessionId` 和非空 alias，Core 返回更新后的 `SessionSummary` 并广播 `session.changed`。共享 ID 继续先调用 `sessions:mark-shared` 再复制返回的 `id`，复制失败不伪造 UI 成功状态。审计设置只调用已有 `audit.list`，不把审计载荷重新塞进 Agent timeline。

## Risks / Trade-offs

- [旧数据仍只有 `title`] → 将 `title` 作为 Alias 的兼容字段，不做强制数据库重命名；新增重命名只更新既有元数据列，并为历史记录保留稳定回退值。
- [标签在极窄窗口中仍可能不足以显示完整别名] → 固定操作区不参与滚动，标签使用 `min/max` 宽度、ellipsis、横向滚动和完整 tooltip，不能通过缩放字体解决溢出。
- [Session 状态点与 Agent 状态混淆] → 状态点只由 PTY/Shell 状态映射函数驱动，Agent active turn 只能出现在运行状态栏和 Composer 控件中，并添加映射单测。
- [progress 事件在历史恢复时重复] → 继续复用现有 timeline reducer 的稳定事件 ID 和 history hydration 边界；Renderer 只过滤 progress snapshot 的可见节点，不在 Renderer 另建 plan 投影槽位。
- [隐藏 ACP 后已有外部任务缺少桌面入口] → 不删除 ACP 后端或取消 API；禁止新的桌面启动入口，同时保留 Core 事件和数据，以便后续恢复或提供专门的兼容处理。
- [共享操作的 Core 更新与剪贴板写入存在先后失败] → 先完成 `markShared` 才允许外部寻址，再写入返回的真实 `id`；任一步失败都显示可恢复错误并不显示成功 toast。
- [取消按钮重用后误提交空目标或重复取消] → 发送/停止动作由单一状态机派生；取消中锁定按钮，空闲态才校验目标文本，使用现有 cancellation pending 测试覆盖竞态。

## Migration Plan

1. 先扩展协议、Core handler、持久化元数据和 preload 的重命名契约，保留现有 `title` 和 `sessions:mark-shared` 行为；补齐单元测试后再接 Renderer。创建顺序元数据通过自动 schema migration 加入，旧记录使用插入顺序回退。
2. 改造 Session 标签与新建/重命名交互，验证已有 Session、Shared Session 和 MCP 调用仍按原 `id` 工作。
3. 将 Agent 面板切换为无标题栏的单列布局，过滤 progress snapshot 卡片，保留 Tool 和审批事件，接入运行态/Composer 状态机，迁移审计到设置页面并隐藏 ACP 桌面入口。
4. 运行 TypeScript/单元测试、Playwright 工作区场景和宽窄视口视觉检查；发布时不需要单独的数据迁移脚本，启动时自动执行 schema migration。若 UI 回归，可回滚 Renderer 变更，Core 的 Alias 字段仍兼容原 `title` 数据。

## Open Questions

- 设置页中的审计入口是否需要全局审计和当前 Session 两种筛选，还是先只提供当前 Session 过滤；本 change 默认保留现有 `audit.list` 的可选过滤能力。
- “全部会话”弹层是否在后续版本支持拖拽排序；本 change 固定按创建顺序，不引入用户排序持久化。
