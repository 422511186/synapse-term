## Why

当前桌面工作区的 Session 标签、Agent 时间线和运行态控件仍沿用早期原型：标签在窄窗口中容易挤压，Agent 面板层级不清晰，用户无法快速判断当前任务进展或复制可供 MCP 使用的 Session ID。现在已有多 Session、结构化进度和共享会话能力，需要把这些能力整理成稳定、可扫描且适配响应式窗口的工作区交互。

## What Changes

- 优化 Session 标签栏：保留多个可直接切换的标签，按创建顺序排列并支持横向滚动；在标签组右侧固定新建、全部会话和“共享 ID”入口。
- 为新建 Session 提供 `终端 N` 默认别名，用户清空名称时回退到当前最小未占用编号；支持通过标签上下文操作重命名，别名允许重复且不替代唯一 `sessionId`。
- 将共享 Session ID 入口放到标签栏右侧，宽屏显示图标和文字、窄屏保留图标；复制后标记当前 Session 为 `Shared Session`，MCP 继续使用唯一 `sessionId` 寻址。
- 将 Agent 面板改为无额外标题栏的单一工作区，移除顶部 `Agent Timeline`/`审计日志` 双 Tab 和内置 Agent 就绪状态条，审计日志改从设置进入；暂时隐藏 ACP/外置 Agent 的桌面入口，保留后端驱动能力。
- 不在 Agent 面板单独显示 plan 卡片、plan 槽位或 progress snapshot 卡片；progress 数据仍由运行时和历史保留，Tool、审批和 Assistant 事件继续在现有滚动时间线中按顺序呈现。
- 调整任务内容呈现：用户消息右对齐、Agent 消息左对齐，双方去除头像；Tool 和审批内容使用全宽结构化卡片，progress snapshot 不创建可见节点。
- 将运行状态栏放在 Composer 上方；空闲时发送按钮提交任务，运行时复用为停止按钮，取消请求进行中显示加载并禁用，且在审批、Probe、模型输出和 Tool Result 等阻塞阶段仍可取消。
- 明确标签状态点只表示终端可用性，不表示 Agent 运行态，并优化激活态、关闭按钮、Shell 类型文字和窄窗口下的布局。

## Capabilities

### New Capabilities

无。本次变更整理和扩展已有桌面工作区与结构化进度能力，不新增独立领域能力。

### Modified Capabilities

- `desktop-terminal`: 修改 Session 标签、Session 别名和共享 ID 的桌面交互；重构 Agent 面板、审计入口、外置 Agent 可见性、消息布局、运行状态栏和取消控件。

## Impact

- 影响桌面 Renderer 的 Session tab strip、Session 创建/重命名菜单、Agent panel、Timeline/Composer 和设置导航，以及对应的 preload/Core 查询与复制动作接线。
- 需要新增或调整 Session 别名的 UI 状态持久化/恢复、共享标记反馈和 `sessionId` 复制反馈；不会改变 MCP 的寻址字段或后端 Session ID。
- 需要覆盖多标签窄窗口布局、默认名称回退、关闭运行中 Session 确认、共享 ID、运行态取消和审计入口迁移的单元/集成测试，并补充关键视口的视觉回归检查。
- 外置 ACP Agent 的后端协议和执行管线继续保留，但当前桌面产品不再提供其选择或启动入口，后续可单独恢复可见性。
