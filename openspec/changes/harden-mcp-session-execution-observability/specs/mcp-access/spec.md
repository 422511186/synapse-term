## ADDED Requirements

### Requirement: Execution Context Guard

外部客户端的结构化执行 MUST 绑定最近观察到的 `executionContextId`。`synapse_observe`、`synapse_execute` 和 `synapse_wait` 可以返回当前 ID；`synapse_status` MUST NOT 返回该 ID。`synapse_execute` 缺少或提供过期 ID 时 MUST 在用户命令写入 PTY 前拒绝调用，并指引 Agent 先观察当前终端内容。

#### Scenario: First execution requires an observation

- **WHEN** 外部客户端首次调用 `synapse_execute` 且未提供 `expectedContextId`
- **THEN** 调用 MUST 返回 `EXECUTION_CONTEXT_REQUIRED`，不得写入用户命令，并指引 Agent 调用 `synapse_observe` 获取当前终端内容和 ID

#### Scenario: Stale execution context is rejected

- **WHEN** 外部客户端提供的 `expectedContextId` 与当前 Session 的 ID 不匹配
- **THEN** 调用 MUST 返回 `EXECUTION_CONTEXT_STALE`，不得写入用户命令，并指引 Agent 使用 `synapse_observe`（必要时 `tail: true`）重新观察后再决定是否执行

#### Scenario: Context changes during preflight

- **WHEN** 用户在 Probe 或审批等待期间改变当前 PTY，导致原执行上下文失效
- **THEN** 系统 MUST 在写入用户命令前再次拒绝该调用，旧 Probe 和旧审批不得继续放行用户命令

#### Scenario: Passive output does not invalidate the context ID

- **WHEN** 当前 Session 只有被动日志或提示符输出增长而没有新的用户/外部输入
- **THEN** `executionContextId` MUST 保持不变，输出位置只通过 `outputCursor` 变化

### Requirement: External Transaction State Contract

每个已接受的外部事务 MUST 只允许在一个共享 Session 上单独运行，并对外公开 `running`、`completed`、`interrupted` 或 `unknown` 状态。非零退出码仍 MUST 表示 `completed`；无法确认命令结果时 MUST 使用 `unknown`，并返回不可安全自动重提的指引。`not_sent` MUST 作为写入前错误处理，不创建 transactionId。

#### Scenario: Session rejects a concurrent external transaction

- **WHEN** 一个 Session 已存在未收敛的外部事务，另一个外部客户端调用 `synapse_execute`
- **THEN** 调用 MUST 返回 `SESSION_BUSY`，不得写入第二条用户命令

#### Scenario: Non-zero command exit is completed

- **WHEN** 完成 Probe 返回一个非零退出码
- **THEN** 事务 MUST 返回 `status: completed` 和该退出码，不得把已确认的命令结果标记为 `unknown`

#### Scenario: Completion evidence is lost

- **WHEN** 用户命令可能已经写入或执行，但 PTY/连接在有效完成证据到达前断开
- **THEN** 事务 MUST 进入 `unknown`，明确 `retryable: false` 和 `safeToResubmit: false`，不得自动重新提交

#### Scenario: Wait reaches its per-call timeout

- **WHEN** `synapse_wait` 在本次调用的等待时限内没有等到事务终态
- **THEN** 调用 MUST 返回当前 `running` 快照并标记本次等待超时，事务仍可继续等待、观察或中断

#### Scenario: User input interferes with a running transaction

- **WHEN** 用户在事务尚未获得完成证据前向同一 PTY 输入内容
- **THEN** 本地输入 MUST 保持可用，事务 MUST 进入 `unknown`，且外部客户端不得自动重试

### Requirement: Risk Classification Evidence

外部命令的风险结果 MUST 使用原始 command 和已验证的当前 PTY environment 进行保守分类，至少包含 `risk`、`confidence`、`reasons` 和 `requiresConfirmation`。评估 MUST NOT 声称已经验证远程主机权限、目标资源影响或回滚条件；复杂管道、脚本、别名和嵌套调用无法完全静态判断时 MUST 通过低置信度或 `unknown` 表达限制。

#### Scenario: Known read-only command

- **WHEN** 外部客户端提交一个与当前 Shell 方言匹配且命中只读规则的 command
- **THEN** 风险结果 MUST 使用 `read_only`，包含判定原因和相应确认要求

#### Scenario: Complex command has limited confidence

- **WHEN** command 包含脚本、动态替换、别名或无法完全展开的管道
- **THEN** 风险结果 MUST 使用保守的风险类别和较低置信度，并说明无法静态判断的原因，不得伪造远程影响范围

## MODIFIED Requirements

### Requirement: Synapse Tool Surface

MCP 端点 MUST 暴露且仅暴露五个工具：`synapse_execute`（按执行上下文执行命令并开启事务）、`synapse_observe`（分页读取 PTY 输出历史）、`synapse_wait`（等待事务收敛）、`synapse_interrupt`（向进行中的事务所属 PTY 发送中断）、`synapse_status`（只读探测会话状态）。所有工具 MUST 以 `sessionId` 寻址；工具 Schema MUST 完整声明参数与含义；MUST NOT 提供上述清单之外的任何工具。

`synapse_execute` MUST 接收 `expectedContextId`、原文 `command` 和可选的观察窗口；`synapse_observe` MUST 接收可选的 `afterCursor`、`tail` 和 `maxBytes`；`synapse_wait` MUST 接收 transactionId 和单次等待时限，单次等待默认 30 秒且不得超过 60 秒；`synapse_interrupt` MUST 接收 transactionId。工具响应 MUST 能表达即时输出、事务输出范围、下一游标、截断状态和当前执行上下文 ID；原始 PTY 字节、Probe 原文和屏幕快照不属于工具响应。

#### Scenario: Execute opens a transaction

- **WHEN** 外部客户端调用 `synapse_execute` 且策略允许
- **THEN** 命令写入共享会话 PTY，返回事务 ID 与观察窗口内的初始输出

#### Scenario: Execute opens a guarded transaction

- **WHEN** 外部客户端调用 `synapse_execute`，携带当前 `expectedContextId` 且策略/审批允许
- **THEN** 系统 MUST 在 Probe 与执行前再验证通过后，将用户 command 原文写入共享 Session PTY，返回 transactionId、事务状态、有限即时输出、事务输出范围和当前执行上下文 ID

#### Scenario: Observe paginates history

- **WHEN** 外部客户端调用 `synapse_observe` 并传入 `afterCursor` 与 `maxBytes`
- **THEN** 系统 MUST 返回不超过服务端上限的清理脱敏文本、`nextCursor` 和 `hasMore`，且不得消费历史

#### Scenario: Interrupt an in-flight transaction

- **WHEN** 外部客户端对进行中的事务调用 `synapse_interrupt`
- **THEN** 系统 MUST 向当前 Session PTY 发送中断，并按照可验证事务证据返回中断、完成或不确定结果，不得声称远程进程已终止

### Requirement: Stable External Error Codes

所有 `synapse_*` 工具的错误结果 MUST 以稳定可解析的错误码开头：会话未就绪为 `SESSION_NOT_READY`，会话失效为 `SESSION_EXPIRED`，租约不可用为 `SESSION_BUSY`，事务不存在为 `TRANSACTION_NOT_FOUND`，策略拒绝为 `POLICY_DENIED`，Shell 方言不匹配为 `SHELL_MISMATCH`，命令违反字面审计边界为 `COMMAND_NOT_AUDITABLE`，已知交互式命令不支持为 `INTERACTIVE_COMMAND_UNSUPPORTED`，缺少执行上下文为 `EXECUTION_CONTEXT_REQUIRED`，执行上下文失配为 `EXECUTION_CONTEXT_STALE`，审批超时为 `APPROVAL_TIMEOUT`，审批拒绝为 `APPROVAL_DENIED`。错误文本 MUST 同时包含错误码、原因说明与下一步指引；MUST NOT 泄露其他会话信息。

#### Scenario: Execute fails while shell not ready

- **WHEN** `synapse_execute` 到达且 Shell 正在探测
- **THEN** 错误以 `SESSION_NOT_READY` 开头并附稍后重试指引

#### Scenario: Transaction not found

- **WHEN** `synapse_wait` 携带不存在的事务 ID
- **THEN** 错误以 `TRANSACTION_NOT_FOUND` 开头并指引检查 execute 返回值

#### Scenario: Missing execution context

- **WHEN** `synapse_execute` 没有携带 `expectedContextId`
- **THEN** 错误 MUST 以 `EXECUTION_CONTEXT_REQUIRED` 开头，且用户命令不得写入 PTY

#### Scenario: Stale execution context

- **WHEN** `synapse_execute` 携带的 `expectedContextId` 已因用户输入或其他外部事务失效
- **THEN** 错误 MUST 以 `EXECUTION_CONTEXT_STALE` 开头，指引 Agent 先调用 `synapse_observe` 获取当前内容和新 ID

#### Scenario: Known interactive command

- **WHEN** 外部客户端提交明确需要持续交互或不会返回当前 Shell 提示符的 command
- **THEN** 调用 MUST 以 `INTERACTIVE_COMMAND_UNSUPPORTED` 开头失败，且不得写入用户命令

#### Scenario: Transaction is unknown after a disconnect

- **WHEN** 外部事务在完成证据到达前失去 PTY 或连接
- **THEN** 工具结果 MUST 返回 `unknown` 事务状态和不可自动重试的指引，而不是把它伪装成 `POLICY_DENIED` 或普通失败
