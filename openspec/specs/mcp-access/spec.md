# mcp-access Specification

## Purpose

TBD：内嵌 MCP Server 为本机外部客户端提供已共享 Session 的受控访问、工具调用与审批能力。

## Requirements

### Requirement: Embedded MCP Endpoint
MCP Server MUST 作为 Electron Main 的可选内嵌模块运行，仅监听本机回环地址，默认处于关闭状态；启用/禁用开关 MUST 位于设置工作区。MCP 端点 MUST 使用可吊销的 Bearer token 认证；吊销后所有未完成调用 MUST 被拒绝。关闭开关或退出应用时端点 MUST 停止。

#### Scenario: Enable MCP endpoint in settings
- **WHEN** 用户在设置中启用 MCP Server 并复制连接串（回环地址 + token）到外部客户端
- **THEN** 外部客户端可通过该连接串在回环地址上访问 `/mcp` 端点

#### Scenario: Token revoked
- **WHEN** 用户吊销当前 token 后外部客户端继续调用
- **THEN** 所有新调用返回认证失败，已建立的连接不得继续执行工具

#### Scenario: Default state
- **WHEN** 应用首次启动且用户从未配置 MCP
- **THEN** 端点不监听任何端口，外部客户端无法建立连接

### Requirement: External Session Addressing and Sharing
外部工具调用 MUST 携带 sessionId 参数；未携带、不存在、未共享或已取消共享的会话 MUST 返回稳定错误码 `SESSION_EXPIRED` 并附重新共享指引。共享采用两段式：用户先复制连接串建立通道，再通过终端标签的共享动作获取共享文本；共享文本 MUST 包含 sessionId、可用工具清单与连接前提说明，且 MUST 同时提供仅复制裸 ID 的次级动作。系统 MUST NOT 向外部客户端提供会话枚举、列表或发现能力。共享状态随 PTY 退出自动失效。

#### Scenario: Caller supplies a valid shared id
- **WHEN** 外部调用携带用户已共享的、存在且就绪的 sessionId
- **THEN** 调用被翻译为针对该会话的内部作用域调用并进入工具管线

#### Scenario: Caller supplies an invalid id
- **WHEN** 外部调用携带不存在或未共享的 sessionId
- **THEN** 返回以 `SESSION_EXPIRED` 开头的错误与重新共享指引，且错误信息不包含其他会话的 id、名称或状态

#### Scenario: User copies share text
- **WHEN** 用户在某终端标签上执行共享动作
- **THEN** 剪贴板获得包含该会话 ID 与工具使用指引的预置提示词块，且界面提供仅复制裸 ID 的次级按钮

#### Scenario: Unshare from settings
- **WHEN** 用户在设置的已共享会话列表中取消某个会话的共享
- **THEN** 该会话的所有后续外部调用返回 `SESSION_EXPIRED`

### Requirement: Execution Context Guard

外部客户端的结构化执行 MUST 绑定最近观察到的 `executionContextId`。`synapse_observe`、`synapse_execute` 和 `synapse_wait` 可以返回当前 ID；`synapse_status` MUST NOT 返回该 ID。`synapse_execute` 缺少或提供过期 ID 时 MUST 在用户命令写入 PTY 前拒绝调用，并指引外部客户端先观察当前终端内容。

#### Scenario: First execution requires an observation

- **WHEN** 外部客户端首次调用 `synapse_execute` 且未提供 `expectedContextId`
- **THEN** 调用 MUST 返回 `EXECUTION_CONTEXT_REQUIRED`，不得写入用户命令，并指引外部客户端调用 `synapse_observe` 获取当前终端内容和 ID

#### Scenario: Stale execution context is rejected

- **WHEN** 外部客户端提供的 `expectedContextId` 与当前 Session 的 ID 不匹配
- **THEN** 调用 MUST 返回 `EXECUTION_CONTEXT_STALE`，不得写入用户命令，并指引外部客户端使用 `synapse_observe`（必要时 `tail: true`）重新观察后再决定是否执行

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
- **THEN** 该事务被中断并返回中断确认，事务不再收敛为完成态

### Requirement: Session Status Probe
`synapse_status` MUST 以只读方式返回会话状态 `ready`、`not_ready` 或 `expired` 及恢复指引；对失效会话 MUST 返回 `expired` 而非抛错；MUST NOT 创建租约或写入终端；Shell 未就绪时会话 MUST 报告 `not_ready`，恢复后既有工具 MUST 可直接继续使用。

#### Scenario: Probe an expired session
- **WHEN** 外部客户端在会话失效后调用 `synapse_status`
- **THEN** 工具返回 `status: expired` 与重新共享指引

#### Scenario: Probe during shell probing
- **WHEN** 会话存在、PTY 运行但 Shell 未就绪时调用 `synapse_status`
- **THEN** 工具返回 `status: not_ready` 与重试指引；会话恢复后再次调用返回 `ready`

### Requirement: Expired Session Registration Cleanup
当外部调用发现会话不存在、未共享或 PTY 不在运行状态时，处理层 MUST 清理该会话缓存的执行管线注册与租约状态；失效会话 MUST NOT 残留可复用的旧执行器。

#### Scenario: Session removed while pipeline cached
- **WHEN** 终端 PTY 退出导致会话移除后，客户端再次调用任意 `synapse_*` 工具
- **THEN** 该会话的缓存管线被清理，调用收到 `SESSION_EXPIRED` 且后续调用不会命中残留状态

### Requirement: Three-Tier Approval Modes
审批模式 MUST 提供三档：`read_only` 只自动放行观察类调用、拒绝其余；`managed` 额外自动放行低危写类，高危与未分类 MUST 触发审批卡片；`full` 不做风险审查全部放行。配置文件缺失、损坏或含未知模式值时 MUST 回退 `read_only` 且端点关闭。选择 `full` MUST 由用户在设置页显式操作并展示高风险提示文案。裁决矩阵按 ADR-0015 执行。

#### Scenario: Read-only rejects writes
- **WHEN** 审批模式为 `read_only` 且外部调用 `synapse_execute`
- **THEN** 调用被拒绝并返回稳定错误码，不弹出审批卡片

#### Scenario: Managed escalates unknown commands
- **WHEN** 审批模式为 `managed` 且命令被风险分类判定为高危或未分类
- **THEN** 调用进入审批卡片流程等待人工裁决

#### Scenario: Full mode allows all
- **WHEN** 用户显式选择 `full` 模式且外部提交任意风险级别命令
- **THEN** 调用自动放行，输出仍经脱敏管线

#### Scenario: Corrupted configuration falls back
- **WHEN** 设置文件损坏或审批模式值非法
- **THEN** 加载结果回退为关闭＋`read_only`，外部写类调用默认被拒

### Requirement: Blocking Approval Card for High-Risk Calls
managed 模式下需要人工裁决的调用 MUST 同步阻塞等待：Main 持 FIFO 审批队列串行向 Renderer 推送模态卡片并触发窗口抢注意力；每张卡片自展示起 60 秒超时，超时 MUST 返回 `APPROVAL_TIMEOUT`，用户点拒绝 MUST 返回 `APPROVAL_DENIED`。卡片 MUST 展示命令全文、目标会话、风险分类理由，并提供三个动作：允许一次／会话内放行该命令／拒绝。一次批准仅对当次调用生效。卡片的层级、文字、风险标签、命令区域和操作控件 MUST 使用当前 scheme 的可读颜色；普通文字与背景对比度 MUST 至少为 4.5:1，非文字控件边界和焦点指示 MUST 至少为 3:1。命令全文 MUST 在内容较长时可滚动或折叠查看，不得撑破视口或遮挡卡片操作区。

#### Scenario: User approves once
- **WHEN** 用户在卡片上点击“允许一次”
- **THEN** 该次调用继续执行并返回结果，同类后续调用仍弹卡

#### Scenario: Timeout denies
- **WHEN** 卡片展示超过 60 秒无任何用户操作
- **THEN** 对应调用返回以 `APPROVAL_TIMEOUT` 开头的错误，队列推进到下一张卡片

#### Scenario: User denies
- **WHEN** 用户在卡片上点击“拒绝”
- **THEN** 对应调用返回以 `APPROVAL_DENIED` 开头的错误，不执行命令

#### Scenario: Approval card remains readable in light scheme
- **WHEN** 当前有效 scheme 为 `light` 且 managed 模式下出现需要人工裁决的高危或未分类外部调用
- **THEN** 用户 MUST 能清楚阅读命令全文、风险理由和三个动作，且命令区域不得被半透明背景或低对比度状态色干扰

### Requirement: In-Session Command Grant
审批卡片上的会话内放行 MUST 仅对同一会话内与已放行命令全文精确相等的后续调用自动通过；记忆 MUST 存于该会话的管线缓存并随会话关闭、取消共享或 PTY 退出而销毁；MUST NOT 持久化、跨会话或提供通配符/前缀匹配。

#### Scenario: Exact match auto-allows within session
- **WHEN** 用户曾在本会话放行命令 `npm test`，随后同会话再次到达完全相同的命令
- **THEN** 调用自动放行，不弹卡

#### Scenario: Grant does not leak across sessions or variants
- **WHEN** 另一会话到达 `npm test`，或本会话到达 `npm run test`
- **THEN** 两种情况均不命中记忆，照常走分类与审批流程

### Requirement: Output Redaction in All Modes
所有工具返回的输出 MUST 经脱敏管线处理，三档审批模式下一视同仁；`full` 模式放行的是执行权而非明文输出权。

#### Scenario: Secret in command output is masked
- **WHEN** 命令输出包含疑似凭据内容且模式为 `full`
- **THEN** 返回给外部客户端的内容中该片段被打码

### Requirement: Local Execution Visibility
事务执行期间（自 `synapse_execute` 起，至收敛或被打断），系统 MUST 在对应会话标签显示进行中徽标并在终端面板顶部显示状态栏，标注正在被外部执行的命令与来源；状态栏 MUST 占用独立布局空间，长命令的视觉摘要不得覆盖或遮挡 Terminal Session 输出。命令全文可通过省略提示或详情交互查看。状态栏 MUST 保持信息展示性质，本地输入 MUST 保持可用，不得锁定或拦截本地键盘输入。瞬时调用（status/observe/wait 之外的短操作）不打标；wait 挂起期间标记持续。

#### Scenario: Badge shows during external execution
- **WHEN** 外部调用 `synapse_execute` 开始一个事务
- **THEN** 会话标签出现徽标、面板出现状态栏，悬停或详情查看可见命令全文与来源客户端标识

#### Scenario: Local typing stays available
- **WHEN** 外部事务执行期间用户聚焦该终端并键入内容
- **THEN** 键入正常进入 PTY，不被标记或审批拦截

#### Scenario: Long command does not obscure terminal output
- **WHEN** 外部执行中的命令长度超过状态栏可用宽度
- **THEN** 状态栏 MUST 截断或折叠命令摘要并保留可访问的完整命令，Terminal Session 的输出内容 MUST 仍可阅读

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
- **THEN** 错误 MUST 以 `EXECUTION_CONTEXT_STALE` 开头，指引外部客户端先调用 `synapse_observe` 获取当前内容和新 ID

#### Scenario: Known interactive command

- **WHEN** 外部客户端提交明确需要持续交互或不会返回当前 Shell 提示符的 command
- **THEN** 调用 MUST 以 `INTERACTIVE_COMMAND_UNSUPPORTED` 开头失败，且不得写入用户命令

#### Scenario: Transaction is unknown after a disconnect

- **WHEN** 外部事务在完成证据到达前失去 PTY 或连接
- **THEN** 工具结果 MUST 返回 `unknown` 事务状态和不可自动重试的指引，而不是把它伪装成 `POLICY_DENIED` 或普通失败
