## ADDED Requirements

### Requirement: Structured Execution Write Uncertainty

`synapse_execute` 在「写入尝试已经发起，但 PTY 后端抛错或无法确认用户命令是否交付」时 MUST 以稳定错误码 `EXECUTION_WRITE_UNKNOWN` 失败，且 MUST NOT 返回可操作的 transactionId。系统 MUST 立即失效当前 PTY environment、递增 capability epoch 并轮换 executionContextId；`synapse_execute` 只有在写入调用正常返回后才轮换 executionContextId。用户命令可能已经部分写入或执行，系统 MUST NOT 自动重试，外部客户端 MUST 先重新 `synapse_observe` 并由用户判断后续动作。

写入尝试发起之前的失败不属于本要求：缺少或失配 `expectedContextId`、environment 未验证、Session 不再运行时 MUST 保持既有稳定错误码，MUST NOT 使用 `EXECUTION_WRITE_UNKNOWN`，并 MUST NOT 失效 environment 或轮换 executionContextId。

#### Scenario: Structured execute write outcome is unknown

- **WHEN** 外部客户端以当前 `expectedContextId` 调用 `synapse_execute`，系统已经开始向 PTY 后端写入用户命令，但写入抛错或后端无法确认命令是否已经交付
- **THEN** 调用 MUST 以 `EXECUTION_WRITE_UNKNOWN` 开头失败，MUST NOT 返回可操作的 transactionId，当前 PTY environment MUST 立即失效，capability epoch 与 executionContextId MUST 轮换，且系统 MUST NOT 自动重试该命令

#### Scenario: Pre-send rejection is not write uncertainty

- **WHEN** `synapse_execute` 在写入用户命令之前，因缺少或失配 `expectedContextId`、environment 未验证或 Session 不再运行而失败
- **THEN** 调用 MUST 以对应的既有稳定错误码 `EXECUTION_CONTEXT_REQUIRED`、`EXECUTION_CONTEXT_STALE`、`SESSION_NOT_READY` 或 `SESSION_EXPIRED` 开头失败，MUST NOT 使用 `EXECUTION_WRITE_UNKNOWN`，且 MUST NOT 失效 environment 或轮换 executionContextId

#### Scenario: Unknown structured write requires a new observation

- **WHEN** 一次 `synapse_execute` 以 `EXECUTION_WRITE_UNKNOWN` 失败后，外部客户端立即使用该次调用之前取得的 `expectedContextId` 再次调用 `synapse_execute`
- **THEN** 调用 MUST 以 `EXECUTION_CONTEXT_STALE` 开头失败且不得写入 PTY，外部客户端 MUST 先重新观察并等待 environment 重新验证

## MODIFIED Requirements

### Requirement: Stable External Error Codes

所有 `synapse_*` 工具的错误结果 MUST 以稳定可解析的错误码开头：认证撤销为 `AUTHORIZATION_REVOKED`，会话未就绪为 `SESSION_NOT_READY`，会话失效为 `SESSION_EXPIRED`，租约不可用为 `SESSION_BUSY`，事务不存在为 `TRANSACTION_NOT_FOUND`，策略拒绝为 `POLICY_DENIED`，Shell 方言不匹配为 `SHELL_MISMATCH`，命令违反字面审计边界为 `COMMAND_NOT_AUDITABLE`，已知交互式命令不支持为 `INTERACTIVE_COMMAND_UNSUPPORTED`，缺少执行上下文为 `EXECUTION_CONTEXT_REQUIRED`，执行上下文失配为 `EXECUTION_CONTEXT_STALE`，输出游标失效为 `OUTPUT_CURSOR_STALE`，审批超时为 `APPROVAL_TIMEOUT`，审批拒绝为 `APPROVAL_DENIED`，输入授权失效或额度耗尽为 `INPUT_GRANT_EXHAUSTED`，输入写入交付无法确认为 `INPUT_WRITE_UNKNOWN`，交互启动写入交付无法确认为 `INTERACTIVE_START_WRITE_UNKNOWN`，结构化执行写入交付无法确认为 `EXECUTION_WRITE_UNKNOWN`。MUST NOT 暴露 `TRANSACTION_NOT_ACTIVE`。事务已终态、未知或不属于当前 Sharing 的未知事务调用统一使用 `TRANSACTION_NOT_FOUND`；已登记 requestId 的相同输入重试例外地只读返回缓存结果。错误文本 MUST 同时包含错误码、原因与下一步指引，且不得泄露其他会话信息。

#### Scenario: No public pre-send transaction race

- **WHEN** 外部客户端调用不存在、未被后端接受，或没有可复用 requestId 的已终态事务 ID 进行 input 或 finish
- **THEN** 调用 MUST 以 `TRANSACTION_NOT_FOUND` 开头，且不得向 PTY 写入任何内容

#### Scenario: Unknown input delivery is not retried blindly

- **WHEN** PTY 后端无法确认某次 input payload 是否已经交付
- **THEN** 调用 MUST 以 `INPUT_WRITE_UNKNOWN` 开头；事务内模式还 MUST 返回 `status: unknown`，并指引客户端不要使用新 requestId 重放

#### Scenario: Unknown interactive start delivery is not retried blindly

- **WHEN** 交互启动 command 的 PTY 写入调用已开始，但后端抛错或无法确认 command 是否已经交付
- **THEN** 调用 MUST 以 `INTERACTIVE_START_WRITE_UNKNOWN` 开头；不得返回可操作的 transactionId 或 inputGrantId，Session environment/context/epoch、未使用授权和交互租约 MUST 按启动写入不确定语义清理，客户端不得使用新调用自动重放

#### Scenario: Unknown structured write delivery is not retried blindly

- **WHEN** 结构化执行 command 的 PTY 写入调用已开始，但后端抛错或无法确认 command 是否已经交付
- **THEN** 调用 MUST 以 `EXECUTION_WRITE_UNKNOWN` 开头；不得返回可操作的 transactionId，Session environment、capability epoch 与 executionContextId MUST 按结构化写入不确定语义清理，且客户端不得使用新调用自动重放

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

### Requirement: Scoped External Input

`synapse_input` MUST 支持两种且仅两种模式。事务内模式 MUST 同时携带 `transactionId`、`inputGrantId` 和唯一 `inputRequestId`，新的输入只能作用于仍为 `running` 的活动交互事务；此前已登记且已完成的相同 requestId 可在事务终态后只读返回缓存结果，不得再次写入。自由模式 MUST 携带 `expectedContextId` 和 `inputRequestId`，且当前 Session 不得存在活动外部事务。两种模式的前提字段 MUST 互斥，`text` 与 `keys` MUST 至少提供其一；规范化后文本为空且键序列为空的请求 MUST 被拒绝且不得消耗授权。

`synapse_execute` MUST NOT 返回后续输入授权；任何预期会读取 stdin 的 command MUST 通过 `synapse_start_interactive`。交互启动 MUST 根据显式的 `inputGrantMode` 返回一次性或有界输入授权。授权 MUST 绑定 Session、事务、外部调用方和用途，不能由原启动调用的 `allow_once` 审批隐式扩大为未声明的输入权限。授权终态、清理或空闲超时后 MUST 撤销。

输入 MUST 先完成规范化和整体校验，再按“先 text、后 keys”的顺序作为一次逻辑 payload 写入 PTY。`text` 只允许可打印 Unicode 字符和 `\n`，换行 MUST 转换为 `\r`；其他 C0/C1 控制字符、DEL、原始 ESC 和任意原始字节 MUST 被拒绝。`keys` MUST 只接受 `up`、`down`、`left`、`right`、`enter`、`esc`、`tab`、`backspace`、`delete`、`home`、`end`、`pageup`、`pagedown`、`space`、`f1` 至 `f12`，并使用设计中固定的 xterm normal-mode 编码。

服务端 MUST 在写入前检查规范化文本 UTF-8 字节数、按键数量和合并 payload UTF-8 字节数；初始上限分别为 8 KiB、128 项和 16 KiB。任一超限时整次调用 MUST 拒绝，任何前缀都不得写入，也不得消耗授权配额。只有首次通过完整校验并实际发起写入的请求才消耗配额；校验/审批拒绝和相同 requestId 的幂等重放不得重复扣减。`textLength` MUST 表示规范化文本的 UTF-8 字节数。

事务内输入 MUST 不校验或轮换 executionContextId，也不得递增 capability epoch；交互事务句柄和 inputGrantId 取代 executionContext 前提，但不取代 Session 就绪前提——Session 不再运行或当前 PTY environment 已不再验证时 MUST 拒绝写入，且该拒绝 MUST NOT 递增 capability epoch 或轮换 executionContextId。自由输入 MUST 原子校验 expectedContextId，并在进入后端写入尝试的同一 Session 队列边界失效 PTY environment、递增 capability epoch 并轮换 executionContextId；即使 write 抛错或交付不确定也不得恢复旧 context，且 MUST 返回 `INPUT_WRITE_UNKNOWN`。自由输入不得创建 transactionId。自由输入遇到活动事务 MUST 返回 `SESSION_BUSY`。

#### Scenario: Transactional input supplies a password

- **WHEN** 交互事务停在密码提示，外部客户端携带正确的 transactionId、inputGrantId、inputRequestId 和密码文本调用 `synapse_input`
- **THEN** 密码 payload MUST 写入该事务所属 PTY，不弹第二张审批卡片，响应 MUST 返回事务快照、输入元数据和即时输出，但 MUST NOT 包含密码原文

#### Scenario: Input grant is exhausted

- **WHEN** 外部客户端提交的 inputGrantId 已过期、已消费或超过交互授权配额
- **THEN** 调用 MUST 以 `INPUT_GRANT_EXHAUSTED` 开头拒绝，且不得写入 PTY

#### Scenario: Free input requires a current context

- **WHEN** 外部客户端未携带活动事务而以当前 expectedContextId 发送菜单按键
- **THEN** 输入 MUST 写入 PTY，环境和 executionContextId MUST 失效并轮换，响应 MUST 返回新的 executionContextId 和即时输出

#### Scenario: Free input is blocked by an active transaction

- **WHEN** 当前 Session 存在活动外部事务，外部客户端使用 expectedContextId 而不携带 transactionId 调用 `synapse_input`
- **THEN** 调用 MUST 以 `SESSION_BUSY` 开头拒绝，且不得写入 PTY，并指引使用该事务的 inputGrantId

#### Scenario: Stale free-input context

- **WHEN** 用户或其他外部操作已使 expectedContextId 失效，外部客户端仍使用旧 ID 调用自由输入
- **THEN** 调用 MUST 以 `EXECUTION_CONTEXT_STALE` 开头拒绝，且不得写入 PTY
