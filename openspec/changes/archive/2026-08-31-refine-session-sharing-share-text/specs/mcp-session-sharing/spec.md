## ADDED Requirements

### Requirement: Explicit Session Sharing Boundary

内嵌 MCP Server MUST 只允许当前由用户显式 Sharing 的 Session 被外部客户端寻址。Sharing registry MUST 位于 Electron Main；未共享、已取消 Sharing、已退出或已从 Session 管理器移除的 Session MUST 对外部客户端返回相同的 `SESSION_EXPIRED` 形态，不得泄露其他 Session 的存在性。`shareSession` 与 `unshareSession` IPC 调用 MUST 返回当前共享 Session 列表快照。

#### Scenario: Share a running Session

- **WHEN** 用户在桌面端对正在运行的 Session 执行 Sharing
- **THEN** Main 将该 Session 加入 Sharing registry，外部客户端可以使用该 `sessionId` 寻址，IPC 返回包含该 Session 的共享列表，其他 Session 仍不可寻址

#### Scenario: Unshare removes external addressing

- **WHEN** 用户取消某个 Session 的 Sharing 后，外部客户端继续携带原 `sessionId` 发起任一 `synapse_*` 外部调用
- **THEN** 调用返回 `SESSION_EXPIRED` 和重新 Sharing 指引，IPC 返回的共享列表不再包含该 Session

#### Scenario: Sharing IPC returns a usable snapshot

- **WHEN** 真实 Electron Renderer 调用 `shareSession` 或 `unshareSession`
- **THEN** preload Promise MUST resolve为 `SharedMcpSession[]`，Settings Workspace 可以直接使用该结果刷新列表，不得得到 `undefined`

### Requirement: Honest External Session Status

`synapse_status` MUST 只检查调用方提供的单个 `sessionId`，不得创建外部 Lease 或写入 PTY。Session 不存在、未 Sharing、PTY 已退出或 Sharing 已失效时 MUST 返回 `status: expired`；PTY 运行但 current PTY environment 未验证或不完整时 MUST 返回 `status: not_ready`；PTY 运行且 dialect、platform 和 verificationStatus 均已验证时 MUST 返回 `status: ready`。返回值可以包含受限的 `environment` 摘要（仅含 dialect、platform、verificationStatus）和 active transaction 信息，但不得返回 Token、Lease、capability epoch 或其他 Session 列表。

#### Scenario: Running Session without verified environment

- **WHEN** 外部客户端对已 Sharing 且 PTY running、但 current PTY environment 尚未验证的 Session 调用 `synapse_status`
- **THEN** 返回 `status: not_ready`、可重试的 guidance 和未验证的 environment 摘要，不得声称 ready

#### Scenario: Verified POSIX environment

- **WHEN** 外部客户端对已 Sharing 且 current PTY environment 已验证为 POSIX/unix 的 Session 调用 `synapse_status`
- **THEN** 返回 `status: ready` 和 `environment.dialect: posix`、`environment.platform: unix`

#### Scenario: Unknown or expired Session status

- **WHEN** 外部客户端使用不存在、未 Sharing 或已退出的 `sessionId` 调用 `synapse_status`
- **THEN** 返回 `status: expired` 和重新 Sharing 指引，且响应不包含其他 Session 的 id、名称、状态或存在性信息

### Requirement: Stable Current-Environment Errors

外部调用 MUST 区分 current PTY environment 未验证、Shell 方言不匹配和风险策略拒绝。Probe 未完成、超时、歧义、被用户接管或当前环境无效时，执行类调用 MUST 返回以 `SESSION_NOT_READY` 开头的稳定错误，并 MUST NOT 写入用户命令；已验证环境与用户命令方言不匹配时 MUST 返回以 `SHELL_MISMATCH`（或等价稳定环境错误码）开头的错误，并 MUST NOT 写入用户命令；只有 PolicyEngine 或 Approval Mode 真正拒绝时才可返回 `POLICY_DENIED` 或 `APPROVAL_DENIED`。环境类错误不得展示过时的启动 Shell hint，不得要求系统隐式翻译命令。

#### Scenario: PowerShell command in a verified POSIX Session

- **WHEN** 当前 PTY environment 已验证为 POSIX，外部客户端提交 `Write-Output 'value'`
- **THEN** 外部调用返回 `SHELL_MISMATCH`，明确说明当前已验证环境和用户命令未发送，不返回 `POLICY_DENIED`，也不得把该用户命令写入 PTY

#### Scenario: Environment is not verified

- **WHEN** Session 仍在运行但 current PTY environment 未验证，外部客户端提交用户命令
- **THEN** 系统先按固定明文 Probe 尝试验证；若 Probe 未完成或失败，外部调用返回 `SESSION_NOT_READY`，用户命令不得写入 PTY

#### Scenario: Policy rejects a command

- **WHEN** current PTY environment 已验证且命令方言匹配，但审批模式或 PolicyEngine 拒绝该命令
- **THEN** 外部调用返回 `POLICY_DENIED` 或 `APPROVAL_DENIED`，并明确这是风险策略/审批结果，而不是 Shell 方言错误

### Requirement: Revocation Cancels Pending External Calls

取消 Sharing、Session 退出、MCP 服务停用、Token 吊销或 Token 重新生成 MUST 使受影响的外部 Pipeline 进入不可恢复的 disposed 状态，并幂等清理按 Session 的 Probe、会话内放行、外部 Lease、CommandExecutor 和 Approval Card。清理完成后，旧的审批 ID、Probe 结果和异步授权恢复 MUST NOT 写入用户命令；已经写入 PTY 的命令无法撤回时，系统 MUST 尽力中断并如实返回事务终态。

#### Scenario: Unshare while an Approval Card is visible

- **WHEN** 高危外部调用已经进入某 Session 的 Approval Card，用户取消该 Session 的 Sharing，然后用户点击旧 Approval Card 的允许按钮
- **THEN** 旧审批 MUST 被取消或判定为无效，外部调用不得继续进入 CommandExecutor，用户命令不得写入 PTY

#### Scenario: Session exits while an external call is pending

- **WHEN** PTY 退出或 Session 被关闭时，该 Session 存在 Probe、Approval 或外部事务
- **THEN** 对应 Pipeline、Probe、Approval、Lease 和执行器状态被清理，后续使用相同 `sessionId` 返回 `SESSION_EXPIRED`，不得复用旧事务

#### Scenario: Token is revoked during external access

- **WHEN** 用户吊销或重新生成 MCP Token，且存在未完成外部调用
- **THEN** 旧 MCP 调用和受影响的 Sharing MUST 失效，未写入的用户命令不得继续发送，重新启用外部接入后必须重新配置新 Token 并由用户再次 Sharing

### Requirement: Complete External Output Capture

外部事务在收到匹配的固定完成帧后 MUST 在有上限的短 drain window 内继续接收同一 Session 的已到达 PTY 输出，再生成最终 `CommandExecutionResult`。drain window 内迟到的 stdout MUST 被纳入事务输出并保持原有顺序；完成帧仍是退出码和事务收敛证据。排空 MUST NOT 重新执行命令、等待新的 Probe、修改用户 command 原文或把后续事务并入当前事务。

#### Scenario: macOS stdout arrives after the completion frame

- **WHEN** 通过 Windows 本地 PTY SSH 到 macOS zsh 后执行 `uname -s`，匹配完成帧先于相邻 PTY 数据事件中的 `Darwin` stdout 到达，且 stdout 在 drain window 内到达
- **THEN** 外部调用返回 `completed`、退出码为 0，结果输出包含 `Darwin` 和命令回显，不得只有命令回显

#### Scenario: Output is split around the completion frame

- **WHEN** 命令回显、stdout、OSC 777 完成帧和 stdout 分布在多个 PTY 数据块中
- **THEN** 协议输出按 sequence 保持顺序，OSC 777 和探针回显继续被过滤，drain window 内的业务 stdout 被保留且不重复

### Requirement: Auditable Share Text

Share Text MUST 只描述一个明确共享的 Session 和连接前提：内嵌 MCP Server、MCP 服务中配置 `Authorization: Bearer <Token>` 请求头、工具使用顺序、用户命令按原文发送、current PTY environment 以运行时 Probe/status 为准，以及 Probe 可能被目标 Shell、SSH 或远程服务器记录。Share Text MUST NOT 包含真实 Token、Token URL、其他 Session 列表、过时启动 Shell 作为当前事实，或要求外部客户端添加隐式翻译、编码和 wrapper。Session Alias 等用户可编辑字段写入 Share Text 前 MUST 被限制为单行安全文本。

#### Scenario: Share Text after a PowerShell-to-macOS SSH hop

- **WHEN** 用户从启动提示为 PowerShell 的 Session 进入 macOS zsh 后生成 Share Text
- **THEN** Share Text MUST 将启动提示标记为仅供参考或完全省略，并要求外部客户端以当前 PTY environment 为准，不得指导其发送 PowerShell 命令

#### Scenario: Share Text never contains credentials

- **WHEN** 用户生成并复制 Share Text
- **THEN** 文本可以包含 `<Token>` 的配置位置说明，但不得包含当前真实 Token，且不得把 Token 放入 `sessionId`、URL 或 command

#### Scenario: Share Text gives a recoverable workflow

- **WHEN** 外部客户端读取 Share Text
- **THEN** 文本指导其先调用 `synapse_status`，执行时使用 `synapse_execute` 返回的 transactionId 调用 `synapse_wait`，仅使用该 Session 的五个 `synapse_*` 工具，并在 `SESSION_NOT_READY`、`SHELL_MISMATCH` 或 `SESSION_EXPIRED` 时按错误指引停止盲目重试

### Requirement: Honest Sharing UI State

Sharing 对话框 MUST 分别展示 Session 是否已 Sharing 与内嵌 MCP Server 是否当前可连接。MCP Server 未启用、Token 缺失或端点未运行时，界面不得显示“服务已配置连接方式”作为确定事实；停用 MCP 或 Token 变更导致 Sharing 被清理后，Settings Workspace MUST 刷新共享列表并提示用户重新配置/Sharing。

#### Scenario: Session is shared while MCP service is stopped

- **WHEN** 用户完成 Sharing，但内嵌 MCP Server 当前未启用或没有有效 Token
- **THEN** 对话框仍可展示 Session 已 Sharing，但明确提示 MCP Server 尚未运行及需要到 MCP 服务设置配置，Share Text 不包含真实 Token

#### Scenario: Settings list refreshes after revocation

- **WHEN** 用户在 Settings Workspace 吊销 Token、重新生成 Token 或停用 MCP Server
- **THEN** 页面显示的共享 Session 列表与 Main 当前 registry 一致，不保留已失效的旧 Sharing 条目
