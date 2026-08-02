## ADDED Requirements

### Requirement: Toast Notification System
桌面端 MUST 提供统一的 toast 轻提示系统，用于展示非阻塞的操作结果：成功提示 MUST 在 3 秒内自动消失，错误提示 MUST 保持到用户手动关闭；同一时间最多展示 3 条，重复同类消息 MUST 合并更新；toast 区域 MUST 使用 `aria-live` 以便屏幕阅读器感知。

#### Scenario: Successful configuration operation
- **WHEN** 用户启用模型且操作成功
- **THEN** 系统 MUST 显示成功 toast（如"模型已启用"）并在 3 秒内自动消失

#### Scenario: Failed configuration operation
- **WHEN** 检测模型失败并返回分类原因（如 401、模型不存在、连接拒绝）
- **THEN** 系统 MUST 显示错误 toast 且不自动消失，用户关闭后消失

#### Scenario: Toast flood
- **WHEN** 短时间内产生超过 3 条 toast 消息
- **THEN** 系统 MUST 最多展示 3 条并合并相同内容的重复消息

### Requirement: Async Action Button States
所有有界异步操作按钮 MUST 具备明确的三态反馈：待命态显示操作名称；进行中态 MUST 禁用按钮、显示 spinner 与进行中文案，并设置 `aria-busy`；完成后 MUST 展示成功态（短暂显示成功文案与图标）或通过 toast 展示失败原因。操作进行中 MUST 忽略同一按钮的重复点击。

#### Scenario: Model test in progress
- **WHEN** 用户点击"检测模型"
- **THEN** 按钮 MUST 立即切换为"检测中…"并禁用，重复点击 MUST 被忽略

#### Scenario: Model test succeeds
- **WHEN** 检测模型成功返回
- **THEN** 按钮 MUST 短暂显示"检测通过"（含耗时），并展示成功 toast 与更新后的模型状态

#### Scenario: Model test fails
- **WHEN** 检测模型抛出错误
- **THEN** 按钮 MUST 恢复待命态，并通过错误 toast 展示分类原因

### Requirement: Action Debounce and Double-Click Protection
桌面端所有触发 IPC 异步操作的用户控件 MUST 采用 leading-edge 防连点：首次点击立即生效，请求未 settle 前忽略该控件的后续点击；快速切换类操作（启用/停用、审批模式、权限切换）在请求完成后 MUST 立即恢复可点，且同一时刻每个控件最多允许一个未 settle 的请求。提交类按钮（保存、批准、拒绝、创建、删除确认）MUST 同样受此保护。

#### Scenario: Rapid repeated click on test
- **WHEN** 用户在"检测模型"上进行快速连续点击
- **THEN** 系统 MUST 只发起一次 `models.test()` 请求

#### Scenario: Rapid toggle of model enabled
- **WHEN** 用户快速连续点击模型启用/停用开关
- **THEN** 系统 MUST 只在当前请求 settle 后处理下一次切换，且最终状态与最后一次有效点击一致

#### Scenario: Double-submit approval
- **WHEN** 用户快速连点"批准执行"
- **THEN** 系统 MUST 只调用一次 `agent.approve` 或 `acp.respondApproval`

### Requirement: Confirmation for Destructive Operations
删除模型、删除 Provider、吊销 token、清空 Agent 会话与退出 Core 等破坏性操作 MUST 在执行前展示确认对话框，明确说明后果；确认对话框的确认按钮 MUST 显示 pending 态并防连点，取消或关闭对话框 MUST 不执行操作。

#### Scenario: Delete model requires confirmation
- **WHEN** 用户点击"删除"模型
- **THEN** 系统 MUST 先展示确认对话框，用户确认后才调用 `models.remove()`，删除期间按钮显示 pending 态

#### Scenario: Revoke token requires confirmation
- **WHEN** 用户在 MCP 设置页点击"吊销"
- **THEN** 系统 MUST 先展示确认对话框，确认后才执行吊销，并 toast 展示结果

### Requirement: Running State Indicators
无界运行状态 MUST 通过常驻指示器呈现，而不是仅依赖按钮文字：Agent 运行中 MUST 显示状态条（运行中、当前模型、已运行时长、取消任务入口）；服务开关（MCP/ACP）进行中 MUST 在开关与状态行显示"正在启动…/正在停止…"，完成后落定到"运行中/未运行"。运行指示器 MUST 在状态结束时移除或复位。

#### Scenario: Agent task is running
- **WHEN** Agent 任务处于运行中且时间线暂无新事件
- **THEN** 面板 MUST 显示"Agent 运行中"状态条，包含当前模型与持续增长的运行时长

#### Scenario: MCP server is starting
- **WHEN** 用户启用 MCP Server 且端口尚未就绪
- **THEN** 状态行 MUST 显示"正在启动…"且开关保持禁用，就绪后显示"运行中"与端口

#### Scenario: ACP integration is stopping
- **WHEN** 用户关闭 ACP 集成且存在外部 Agent 子进程
- **THEN** 状态行 MUST 显示"正在停止…"直到子进程终止，随后显示"未运行"
