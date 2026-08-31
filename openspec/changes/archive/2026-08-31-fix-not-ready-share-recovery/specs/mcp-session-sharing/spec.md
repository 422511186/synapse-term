## MODIFIED Requirements

### Requirement: Honest External Session Status

`synapse_status` MUST 只检查调用方提供的单个 `sessionId`，不得创建外部 Lease 或写入 PTY。Session 不存在、未 Sharing、PTY 已退出或 Sharing 已失效时 MUST 返回 `status: expired`；PTY 运行但 current PTY environment 未验证或不完整时 MUST 返回 `status: not_ready`；PTY 运行且 dialect、platform 和 verificationStatus 均已验证时 MUST 返回 `status: ready`。返回值可以包含受限的 `environment` 摘要（仅含 dialect、platform、verificationStatus）和 active transaction 信息，但不得返回 Token、Lease、capability epoch 或其他 Session 列表。`not_ready` 的 guidance MUST 明确 status 是只读快照、不会触发 Probe；当远端 Shell 提示符已就绪时，外部客户端应直接调用 `synapse_execute`，由执行管线在发送用户命令前运行固定明文 Probe。

#### Scenario: Running Session without verified environment

- **WHEN** 外部客户端对已 Sharing 且 PTY running、但 current PTY environment 尚未验证的 Session 调用 `synapse_status`
- **THEN** 返回 `status: not_ready`、可重试的 guidance 和未验证的 environment 摘要，不得声称 ready；guidance MUST 告知外部客户端重复调用 status 不会触发 Probe，远端提示符就绪后应直接调用 `synapse_execute`

#### Scenario: Verified POSIX environment

- **WHEN** 外部客户端对已 Sharing 且 current PTY environment 已验证为 POSIX/unix 的 Session 调用 `synapse_status`
- **THEN** 返回 `status: ready` 和 `environment.dialect: posix`、`environment.platform: unix`

#### Scenario: Unknown or expired Session status

- **WHEN** 外部客户端使用不存在、未 Sharing 或已退出的 `sessionId` 调用 `synapse_status`
- **THEN** 返回 `status: expired` 和重新 Sharing 指引，且响应不包含其他 Session 的 id、名称、状态或存在性信息

### Requirement: Auditable Share Text

Share Text MUST 只描述一个明确共享的 Session 和连接前提：内嵌 MCP Server、MCP 服务中配置 `Authorization: Bearer <Token>` 请求头、工具使用顺序、用户命令按原文发送、current PTY environment 以运行时 Probe/status 为准，以及 Probe 可能被目标 Shell、SSH 或远程服务器记录。Share Text MUST NOT 包含真实 Token、Token URL、其他 Session 列表、过时启动 Shell 作为当前事实，或要求外部客户端添加隐式翻译、编码和 wrapper。Session Alias 等用户可编辑字段写入 Share Text 前 MUST 被限制为单行安全文本。对于 `synapse_status` 返回的 `not_ready`，Share Text MUST 指导外部客户端不要循环查询 status；在远端提示符就绪后直接使用 `synapse_execute` 提交原文命令，由 Synapse Term 先运行 Probe，并在 `SESSION_NOT_READY` 时停止盲目重试。

#### Scenario: Share Text after a PowerShell-to-macOS SSH hop

- **WHEN** 用户从启动提示为 PowerShell 的 Session 进入 macOS zsh 后生成 Share Text
- **THEN** Share Text MUST 将启动提示标记为仅供参考或完全省略，并要求外部客户端以当前 PTY environment 为准，不得指导其发送 PowerShell 命令

#### Scenario: Share Text never contains credentials

- **WHEN** 用户生成并复制 Share Text
- **THEN** 文本可以包含 `<Token>` 的配置位置说明，但不得包含当前真实 Token，且不得把 Token 放入 `sessionId`、URL 或 command

#### Scenario: Share Text gives a recoverable workflow

- **WHEN** 外部客户端读取 Share Text
- **THEN** 文本指导其先调用 `synapse_status`；如果返回 `not_ready`，不得循环调用 status，应在远端 Shell 提示符就绪后直接调用 `synapse_execute`，使用其返回的 transactionId 调用 `synapse_wait`，仅使用该 Session 的五个 `synapse_*` 工具，并在 `SESSION_NOT_READY`、`SHELL_MISMATCH` 或 `SESSION_EXPIRED` 时按错误指引停止盲目重试
