## ADDED Requirements

### Requirement: Sharing-Scoped PTY Output History

内嵌 MCP Server MUST 只向外部客户端提供当前 Sharing 输出边界之后的 PTY 输出历史。Sharing 之前的输出、取消 Sharing 后的旧外部读取位置和其他 Session 的输出 MUST NOT 被回放。

#### Scenario: Sharing starts a new output boundary

- **WHEN** 用户对一个已有历史输出的 Session 执行 Sharing
- **THEN** 外部客户端只能读取 Sharing 建立之后产生的可读 PTY 输出，Sharing 之前的内容不得通过 `synapse_observe` 返回

#### Scenario: Re-sharing resets the boundary

- **WHEN** 用户取消某个 Session 的 Sharing 后再次 Sharing
- **THEN** 系统 MUST 建立新的输出边界，旧外部游标不得读取前一次 Sharing 边界内的内容

### Requirement: Cursor-Paginated External Observation

`synapse_observe` MUST 支持对当前 Sharing 输出边界内的 PTY 输出历史进行不改变历史的分页读取。调用 MUST 支持可选的 `afterCursor`、互斥的 `tail` 和受服务端上限约束的 `maxBytes`；响应 MUST 返回 `nextCursor` 与 `hasMore`，历史超出保留窗口时 MUST 返回 `historyTruncated` 和 `earliestCursor`。

#### Scenario: First observation without a cursor

- **WHEN** 外部客户端首次调用 `synapse_observe` 且未提供 `afterCursor`
- **THEN** 系统 MUST 从当前 Sharing 边界内最早可读的位置返回不超过请求页大小的内容，并返回可用于下一页的 `nextCursor`

#### Scenario: Agent continues from a cursor

- **WHEN** Agent 将上一次响应的 `nextCursor` 作为 `afterCursor` 再次调用 `synapse_observe`
- **THEN** 系统 MUST 只返回该位置之后的历史，并且不得消费、删除或锁定这段历史

#### Scenario: Agent requests the recent tail

- **WHEN** 外部客户端调用 `synapse_observe` 并传入 `tail: true`
- **THEN** 系统 MUST 返回当前 Sharing 边界内最近一页可读内容和当前执行上下文 ID，且 `tail` 与 `afterCursor` 同时出现时 MUST 拒绝调用

#### Scenario: History is outside the retention window

- **WHEN** 外部客户端提供的 `afterCursor` 早于当前输出保留窗口
- **THEN** 系统 MUST 明确返回 `historyTruncated: true` 和可重新同步的 `earliestCursor`，不得用头尾摘要伪装成完整连续历史

### Requirement: Sanitized External PTY History

对外 PTY 输出历史 MUST 在分页之前完成协议帧隔离、自动 Probe 隔离和输出脱敏。外部客户端 MUST 只收到清理后的文本，不得收到原始 PTY 字节流、OSC 777 控制帧、自动 Probe 原文、未回显的原始按键或 ANSI 屏幕快照。

#### Scenario: Probe and control frames are excluded

- **WHEN** PTY 输出包含用户文本、自动 Probe 回显和 OSC 777 完成帧
- **THEN** 外部历史 MUST 只包含协议隔离后的普通可读文本，Probe 回显和控制帧不得作为分页内容返回

#### Scenario: Secret crosses a page boundary

- **WHEN** 疑似凭据文本跨越内部输出块或外部响应页边界
- **THEN** 系统 MUST 先在连续历史上完成脱敏，再按 `afterCursor` 和 `maxBytes` 分页，不得因分页边界泄露凭据片段

## MODIFIED Requirements

### Requirement: Honest External Session Status

`synapse_status` MUST 只检查调用方提供的单个 `sessionId`，不得创建外部 Lease 或写入 PTY。Session 不存在、未 Sharing、PTY 尚未运行、PTY 已退出或 Sharing 已失效时 MUST 返回 `status: expired`；PTY 运行但 current PTY environment 未验证或不完整时 MUST 返回 `status: not_ready`；PTY 运行且 dialect、platform 和 verificationStatus 均已验证时 MUST 返回 `status: ready`。返回值可以包含受限的 `environment` 摘要（仅含 dialect、platform、verificationStatus）、`readinessReason` 和 active transaction 信息，但不得返回 Token、Lease、capability epoch、`executionContextId` 或其他 Session 列表。`readinessReason` MUST 只描述本地 PTY 生命周期、当前环境验证或用户接管事实，不得声称远程主机、SSH 阶段或连接拓扑。`not_ready` 的 guidance MUST 明确 status 是只读快照、不会触发 Probe；当远端 Shell 提示符已就绪时，外部客户端应直接调用 `synapse_execute`，由执行管线在发送用户命令前运行固定明文 Probe。

#### Scenario: Running Session without verified environment

- **WHEN** 外部客户端对已 Sharing 且 PTY running、但 current PTY environment 尚未验证的 Session 调用 `synapse_status`
- **THEN** 返回 `status: not_ready`、本地范围的 `readinessReason` 和未验证的 environment 摘要，不得声称 ready；guidance MUST 告知外部客户端重复调用 status 不会触发 Probe，远端提示符就绪后应直接调用 `synapse_execute`

#### Scenario: Verified POSIX environment

- **WHEN** 外部客户端对已 Sharing 且 current PTY environment 已验证为 POSIX/unix 的 Session 调用 `synapse_status`
- **THEN** 返回 `status: ready` 和 `environment.dialect: posix`、`environment.platform: unix`，且响应不得包含 `executionContextId`

#### Scenario: Unknown or expired Session status

- **WHEN** 外部客户端使用不存在、未 Sharing 或已退出的 `sessionId` 调用 `synapse_status`
- **THEN** 返回 `status: expired` 和重新 Sharing 指引，且响应不包含其他 Session 的 id、名称、状态或存在性信息

#### Scenario: PTY is not externally shareable

- **WHEN** 外部客户端使用不存在、未 Sharing、正在启动或已退出的 `sessionId` 调用 `synapse_status`
- **THEN** 返回 `status: expired` 和重新 Sharing 指引，且响应不包含其他 Session 的 id、名称、状态或存在性信息

### Requirement: Auditable Share Text

Share Text MUST 只描述一个明确共享的 Session 和连接前提：内嵌 MCP Server、MCP 服务中配置 `Authorization: Bearer <Token>` 请求头、工具使用顺序、用户命令按原文发送、current PTY environment 以运行时 Probe/status 为准，以及 Probe 可能被目标 Shell、SSH 或远程服务器记录。Share Text MUST NOT 包含真实 Token、Token URL、其他 Session 列表、过时启动 Shell 作为当前事实，或要求外部客户端添加隐式翻译、编码和 wrapper。Session Alias 等用户可编辑字段写入 Share Text 前 MUST 被限制为单行安全文本。外部客户端在首次 `synapse_execute` 前 MUST 先调用 `synapse_observe` 获取终端内容和 `executionContextId`，再将其作为 `expectedContextId` 传入；上下文冲突后 MUST 使用 `synapse_observe`（必要时 `tail: true`）重新取得内容和 ID。对于 `synapse_status` 返回的 `not_ready`，Share Text MUST 指导外部客户端不要循环查询 status；在远端提示符就绪后直接使用 `synapse_execute`，由 Synapse Term 先运行 Probe，并在 `SESSION_NOT_READY` 或执行上下文冲突时停止盲目重试。

#### Scenario: Share Text establishes an execution context

- **WHEN** 外部客户端读取新生成的 Share Text
- **THEN** 文本 MUST 指导其先调用 `synapse_status`，再调用 `synapse_observe` 获取当前终端内容和 `executionContextId`，之后才调用带 `expectedContextId` 的 `synapse_execute`

#### Scenario: Share Text after a PowerShell-to-macOS SSH hop

- **WHEN** 用户从启动提示为 PowerShell 的 Session 进入 macOS zsh 后生成 Share Text
- **THEN** Share Text MUST 将启动提示标记为仅供参考或完全省略，并要求外部客户端以当前 PTY environment 和新获得的执行上下文 ID 为准，不得指导其发送 PowerShell 命令

#### Scenario: Share Text never contains credentials

- **WHEN** 用户生成并复制 Share Text
- **THEN** 文本可以包含 `<Token>` 的配置位置说明，但不得包含当前真实 Token，且不得把 Token 放入 `sessionId`、URL 或 command

#### Scenario: Share Text gives a recoverable workflow

- **WHEN** 外部客户端按照 Share Text 操作
- **THEN** 文本指导其使用该 Session 的五个 `synapse_*` 工具，先 status、再 observe、再带执行上下文 ID 执行，使用返回的 transactionId 调用 `synapse_wait`，并在 `SESSION_NOT_READY`、`SHELL_MISMATCH`、`SESSION_EXPIRED`、`EXECUTION_CONTEXT_REQUIRED` 或 `EXECUTION_CONTEXT_STALE` 时按错误指引停止盲目重试
