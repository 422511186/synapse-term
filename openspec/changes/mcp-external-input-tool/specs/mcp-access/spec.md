## ADDED Requirements

### Requirement: External Interactive Input
`synapse_input` MUST 以单工具双模式向已共享 Session 的 PTY 写入交互输入。传入 `transactionId` 时为事务内输入：MUST 挂靠进行中的外部事务（前提与 `synapse_interrupt` 相同：租约 + 事务存活且已写入 PTY），MUST 继承原事务的审批结果，MUST NOT 校验或轮换执行上下文 ID，MUST NOT 递增能力代际，事务照常依赖完成探针收敛。传入 `expectedContextId` 时为自由输入：MUST 校验该 ID 通过后才写入，写入后 MUST 轮换该 ID 并保守递增能力代际；后续外部命令 MUST 先重新观察。`transactionId` 与 `expectedContextId` MUST 互斥；`text` 与 `keys` MUST 至少提供其一，同传时 MUST 先发送文本后按序发送按键；`text` 中的换行 MUST 规范化为回车，除换行外的控制字符 MUST 以 `COMMAND_NOT_AUDITABLE` 拒绝且不得写入；`keys` MUST 限定封闭白名单枚举（up、down、left、right、enter、esc、tab、backspace、delete、home、end、pageup、pagedown、space、f1 至 f12），MUST NOT 接受任意转义序列或原始字节。工具响应 MUST NOT 回显 `text` 原文，只 MUST 报告文本长度与按键名，并 MUST 附带固定短窗口的即时输出与下一输出游标；自由模式响应 MUST 返回轮换后的执行上下文 ID。系统 MUST NOT 提供终端正在等待输入的主动信号，输入需求的发现由外部客户端阅读输出判断。

#### Scenario: Transactional input resumes a sudo password prompt
- **WHEN** 外部事务执行 `sudo su` 后停在密码提示，外部客户端携带该 `transactionId` 调用 `synapse_input` 提交密码文本
- **THEN** 密码写入共享 Session 的 PTY 且不弹审批卡片，事务保持运行并随后由完成探针收敛，响应携带事务当前状态与即时输出
- **AND** 响应不包含密码原文，只报告文本长度

#### Scenario: Transactional input on a finished transaction
- **WHEN** 外部客户端携带已终态或不存在的 `transactionId` 调用 `synapse_input`
- **THEN** 错误以 `TRANSACTION_NOT_FOUND` 开头并指引检查 `synapse_execute` 返回的事务 ID

#### Scenario: Transactional input before the command is written
- **WHEN** 目标事务尚处于写入 PTY 之前的窗口
- **THEN** 错误以 `TRANSACTION_NOT_ACTIVE` 开头，输入不写入

#### Scenario: Free input rotates the execution context
- **WHEN** 外部客户端携带当前 `expectedContextId` 调用 `synapse_input` 发送 `vim notes.txt` 与回车
- **THEN** 文本写入共享 Session 的 PTY，响应返回轮换后的新执行上下文 ID 与即时输出，能力代际递增使既有环境验证失效

#### Scenario: Free input with a stale context
- **WHEN** 用户在观察之后按键，外部客户端仍以旧 `expectedContextId` 调用 `synapse_input`
- **THEN** 错误以 `EXECUTION_CONTEXT_STALE` 开头，输入不写入，指引先重新观察

#### Scenario: Free input blocked by an active transaction
- **WHEN** 当前 Session 存在进行中的外部事务，外部客户端不带 `transactionId` 调用 `synapse_input`
- **THEN** 错误以 `SESSION_BUSY` 开头并指引改带 `transactionId` 使用事务内输入，避免活动事务被干扰为不确定态

#### Scenario: Free input requires approval in managed mode
- **WHEN** 审批模式为 `managed` 且外部客户端发起自由输入
- **THEN** 审批卡片同步阻塞等待并明文展示待发内容（文本原文与按键序列），允许一次、会话内放行与拒绝三个动作；会话内放行仅对完全相同的输入表示生效

#### Scenario: Read-only rejects input
- **WHEN** 审批模式为 `read_only` 且外部客户端调用 `synapse_input`
- **THEN** 调用以 `POLICY_DENIED` 拒绝，不弹审批卡片，不写入 PTY

#### Scenario: Text control characters rejected
- **WHEN** `text` 包含换行以外的 C0/C1 控制字符
- **THEN** 错误以 `COMMAND_NOT_AUDITABLE` 开头且输入不写入

#### Scenario: Keys are limited to the closed whitelist
- **WHEN** `keys` 携带白名单之外的键名或调用方试图注入转义序列
- **THEN** 调用被拒绝，任何任意字节序列都不得写入 PTY

#### Scenario: Arrow keys navigate an interactive menu
- **WHEN** 用户已手动连接堡垒机出现交互菜单，外部客户端依次携带最新 `expectedContextId` 调用 `synapse_input` 发送 `["down","down"]` 与 `["enter"]`
- **THEN** 每次按键序列写入 PTY 并在本地终端 UI 自然回显，响应的即时输出反映菜单变化，每次调用后执行上下文 ID 轮换

## MODIFIED Requirements

### Requirement: Synapse Tool Surface
MCP 端点 MUST 暴露且仅暴露六个工具：`synapse_execute`（按执行上下文执行命令并开启事务）、`synapse_observe`（分页读取 PTY 输出历史）、`synapse_wait`（等待事务收敛）、`synapse_interrupt`（向进行中的事务所属 PTY 发送中断）、`synapse_status`（只读探测会话状态）、`synapse_input`（向共享 Session 的 PTY 写入交互输入）。所有工具 MUST 以 `sessionId` 寻址；工具 Schema MUST 完整声明参数与含义；MUST NOT 提供上述清单之外的任何工具。

`synapse_execute` MUST 接收 `expectedContextId`、原文 `command` 和可选的观察窗口；`synapse_observe` MUST 接收可选的 `afterCursor`、`tail` 和 `maxBytes`；`synapse_wait` MUST 接收 transactionId 和单次等待时限，单次等待默认 30 秒且不得超过 60 秒；`synapse_interrupt` MUST 接收 transactionId；`synapse_input` MUST 接收互斥的 `transactionId`（事务内输入）或 `expectedContextId`（自由输入）之一，以及至少其一的 `text`（原样键入文本，换行规范化为回车）或 `keys`（封闭白名单特殊键序列）。工具响应 MUST 能表达即时输出、事务输出范围、下一游标、截断状态和当前执行上下文 ID；原始 PTY 字节、Probe 原文和屏幕快照不属于工具响应；`synapse_input` 的响应 MUST NOT 回显 `text` 原文，只报告文本长度与按键名。

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
- **THEN** 该事务被中断并返回中断确认，事务不再收敛为完成态

### Requirement: Stable External Error Codes
所有 `synapse_*` 工具的错误结果 MUST 以稳定可解析的错误码开头：会话未就绪为 `SESSION_NOT_READY`，会话失效为 `SESSION_EXPIRED`，租约不可用为 `SESSION_BUSY`，事务不存在为 `TRANSACTION_NOT_FOUND`，事务尚未写入 PTY 为 `TRANSACTION_NOT_ACTIVE`，策略拒绝为 `POLICY_DENIED`，Shell 方言不匹配为 `SHELL_MISMATCH`，命令违反字面审计边界为 `COMMAND_NOT_AUDITABLE`，已知交互式命令不支持为 `INTERACTIVE_COMMAND_UNSUPPORTED`，缺少执行上下文为 `EXECUTION_CONTEXT_REQUIRED`，执行上下文失配为 `EXECUTION_CONTEXT_STALE`，审批超时为 `APPROVAL_TIMEOUT`，审批拒绝为 `APPROVAL_DENIED`。错误文本 MUST 同时包含错误码、原因说明与下一步指引；MUST NOT 泄露其他会话信息。

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
- **THEN** 错误 MUST 以 `EXECUTION_CONTEXT_STALE` 开头，指引外部客户端先调用 `synapse_observe` 获取当前内容和新 ID

#### Scenario: Known interactive command

- **WHEN** 外部客户端提交明确需要持续交互或不会返回当前 Shell 提示符的 command
- **THEN** 调用 MUST 以 `INTERACTIVE_COMMAND_UNSUPPORTED` 开头失败，且不得写入用户命令

#### Scenario: Transaction is unknown after a disconnect

- **WHEN** 外部事务在完成证据到达前失去 PTY 或连接
- **THEN** 工具结果 MUST 返回 `unknown` 事务状态和不可自动重试的指引，而不是把它伪装成 `POLICY_DENIED` 或普通失败
