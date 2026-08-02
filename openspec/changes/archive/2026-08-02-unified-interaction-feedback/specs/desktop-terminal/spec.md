## ADDED Requirements

### Requirement: Agent Running Status Indicator
Agent 面板 MUST 在任务运行期间显示常驻运行状态条，包含"Agent 运行中"文案、当前模型名称、持续增长的已运行时长与取消任务入口；状态条 MUST 由 `activeTurn`（含启动中、内置 activeTurn 与 ACP activeTurn）派生，任务结束或取消后 MUST 立即移除。状态条 MUST 不影响现有时间线、审批卡片与 Composer 的可用性。

#### Scenario: Show running status after submit
- **WHEN** 用户提交目标且任务开始运行
- **THEN** 面板顶部 MUST 显示运行状态条，展示当前模型与已运行时长，且取消任务按钮可用

#### Scenario: Clear running status on completion
- **WHEN** Agent 任务完成、失败或用户取消
- **THEN** 状态条 MUST 移除或复位，不再显示运行中

### Requirement: Thinking and Startup Placeholder
时间线 MUST 在任务运行中且自用户消息后尚未收到任何新事件时，显示"思考中…"占位动画；第一条工具/助手/系统事件到达后 MUST 自动移除占位。外部 Agent（ACP）首次启动时，MUST 在 spawn 与握手阶段显示"正在启动外部 Agent…"阶段提示，握手完成后由"外部驱动者已就绪"事件自然衔接。

#### Scenario: Thinking placeholder after submit
- **WHEN** 用户提交目标且模型正在推理、时间线暂无新事件
- **THEN** 时间线 MUST 在用户消息下方显示"思考中…"占位动画

#### Scenario: Placeholder removed on first event
- **WHEN** 第一条工具调用或助手事件到达
- **THEN** "思考中…"占位 MUST 自动移除

#### Scenario: ACP first launch stage hint
- **WHEN** 首次以 ACP 驱动者提交目标且外部 Agent 子进程正在 spawn/握手
- **THEN** 时间线或状态条 MUST 显示"正在启动外部 Agent（opencode）…"，完成后显示"外部驱动者已就绪"

## MODIFIED Requirements

### Requirement: Approval and Takeover Controls
桌面端 MUST 提供命令批准、拒绝、Agent 取消、命令中断和 User Takeover 的明确独立控件。Approval 卡片 MUST 以唯一 approval id 显示生命周期；完成、取消、过期、任务结束或环境失效后不得继续显示可操作的批准按钮。批准、拒绝、取消与中断按钮在请求处理期间 MUST 显示 pending 文案（如"批准中…/拒绝中…/取消中…"）并忽略重复点击。

#### Scenario: Review a mutating command
- **WHEN** Agent 请求执行需要授权的命令
- **THEN** UI 显示完整命令、目标 Session、目的和风险，并允许用户批准或拒绝

#### Scenario: Approval completes or becomes stale
- **WHEN** Core 发出 approval completed、cancelled 或 invalidated 事件
- **THEN** UI 更新同一个 approval 卡片并隐藏批准/拒绝操作，不创建与 Tool 卡片重复的 actionable 卡片

#### Scenario: Resolved approval does not duplicate the tool card
- **WHEN** approval 已完成、取消或因环境失效，且对应 Tool 调用已经显示执行状态或结果
- **THEN** UI 保留 approval id 的状态合并能力，但不再渲染独立的终态 Approval 卡片；执行信息只通过 Tool 卡片展示

#### Scenario: Take over an interactive terminal
- **WHEN** Command Transaction 进入 `interaction_required`
- **THEN** UI 显示接管状态并允许用户获得输入控制权

#### Scenario: Approve or reject is in flight
- **WHEN** 用户点击"批准执行"或"拒绝执行"
- **THEN** 按钮 MUST 立即显示"批准中…/拒绝中…"并禁用，重复点击 MUST 被忽略，请求 settle 后恢复可点

#### Scenario: Cancel task is in flight
- **WHEN** 用户点击"取消任务"且取消请求尚未返回
- **THEN** 按钮 MUST 显示"取消中…"并禁用，重复点击 MUST 被忽略
