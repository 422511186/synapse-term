# mcp-session-sharing Specification

## Purpose

TBD: 规定内嵌 MCP Server 对显式共享 Session 的寻址、当前环境验证、外部调用撤销、审计文本和输出完整性边界。
## Requirements
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

#### Scenario: External client continues from a cursor

- **WHEN** 外部客户端将上一次响应的 `nextCursor` 作为 `afterCursor` 再次调用 `synapse_observe`
- **THEN** 系统 MUST 只返回该位置之后的历史，并且不得消费、删除或锁定这段历史

#### Scenario: External client requests the recent tail

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

### Requirement: Honest External Session Status

`synapse_status` MUST 只检查调用方提供的单个 `sessionId`，不得创建外部 Lease 或写入 PTY。Session 不存在、未 Sharing、PTY 尚未运行、PTY 已退出或 Sharing 已失效时 MUST 返回 `status: expired`；PTY 运行但 current PTY environment 未验证或不完整时 MUST 返回 `status: not_ready`；PTY 运行且 dialect、platform 和 verificationStatus 均已验证时 MUST 返回 `status: ready`。返回值可以包含受限的 `environment` 摘要（仅含 dialect、platform、verificationStatus）、`readinessReason` 和 active transaction 信息，但不得返回 Token、Lease、capability epoch、`executionContextId` 或其他 Session 列表。`readinessReason` MUST 只描述本地 PTY 生命周期、当前环境验证或用户接管事实，不得声称远程主机、SSH 阶段或连接拓扑。`not_ready` 的 guidance MUST 明确 status 是只读快照、不会触发 Probe；当远端 Shell 提示符已就绪时，外部客户端应直接调用 `synapse_execute`，由执行管线在发送用户命令前运行固定明文 Probe。

#### Scenario: Running Session without verified environment

- **WHEN** 外部客户端对已 Sharing 且 PTY running、但 current PTY environment 尚未验证的 Session 调用 `synapse_status`
- **THEN** 返回 `status: not_ready`、可重试的 guidance 和未验证的 environment 摘要，不得声称 ready；guidance MUST 告知外部客户端重复调用 status 不会触发 Probe，远端提示符就绪后应直接调用 `synapse_execute`

#### Scenario: Verified POSIX environment

- **WHEN** 外部客户端对已 Sharing 且 current PTY environment 已验证为 POSIX/unix 的 Session 调用 `synapse_status`
- **THEN** 返回 `status: ready` 和 `environment.dialect: posix`、`environment.platform: unix`，且响应不得包含 `executionContextId`

#### Scenario: Unknown or expired Session status

- **WHEN** 外部客户端使用不存在、未 Sharing 或已退出的 `sessionId` 调用 `synapse_status`
- **THEN** 返回 `status: expired` 和重新 Sharing 指引，且响应不包含其他 Session 的 id、名称、状态或存在性信息

#### Scenario: PTY is not externally shareable

- **WHEN** 外部客户端使用不存在、未 Sharing、正在启动或已退出的 `sessionId` 调用 `synapse_status`
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

Share Text MUST 只描述一个明确共享的 Session 和连接前提：内嵌 MCP Server、MCP 服务中配置 `Authorization: Bearer <Token>` 请求头、工具使用顺序、用户命令按原文发送、current PTY environment 以运行时 Probe/status 为准，以及 Probe 可能被目标 Shell、SSH 或远程服务器记录。Share Text MUST NOT 包含真实 Token、Token URL、其他 Session 列表、过时启动 Shell 作为当前事实，或要求外部客户端添加隐式翻译、编码和 wrapper。Session Alias 等用户可编辑字段写入 Share Text 前 MUST 被限制为单行安全文本。外部客户端在首次 `synapse_execute` 前 MUST 先调用 `synapse_observe` 获取终端内容和 `executionContextId`，再将其作为 `expectedContextId` 传入；上下文冲突后 MUST 使用 `synapse_observe`（必要时 `tail: true`）重新取得内容和 ID。对于 `synapse_status` 返回的 `not_ready`，Share Text MUST 指导外部客户端不要循环查询 status；在远端提示符就绪后直接使用 `synapse_execute`，由 Synapse Term 先运行 Probe，并在 `SESSION_NOT_READY` 或执行上下文冲突时停止盲目重试。

#### Scenario: Share Text establishes an execution context

- **WHEN** 外部客户端读取新生成的 Share Text
- **THEN** 文本 MUST 指导其先调用 `synapse_status`，再调用 `synapse_observe` 获取当前终端内容和 `executionContextId`，之后才调用带 `expectedContextId` 的 `synapse_execute`

#### Scenario: Share Text after a PowerShell-to-macOS SSH hop

- **WHEN** 用户从启动提示为 PowerShell 的 Session 进入 macOS zsh 后生成 Share Text
- **THEN** Share Text MUST 将启动提示标记为仅供参考或完全省略，并要求外部客户端以当前 PTY environment 为准，不得指导其发送 PowerShell 命令

#### Scenario: Share Text never contains credentials

- **WHEN** 用户生成并复制 Share Text
- **THEN** 文本可以包含 `<Token>` 的配置位置说明，但不得包含当前真实 Token，且不得把 Token 放入 `sessionId`、URL 或 command

#### Scenario: Share Text gives a recoverable workflow

- **WHEN** 外部客户端按照 Share Text 操作
- **THEN** 文本指导其使用该 Session 的五个 `synapse_*` 工具，先 status、再 observe、再带执行上下文 ID 执行，使用返回的 transactionId 调用 `synapse_wait`，并在 `SESSION_NOT_READY`、`SHELL_MISMATCH`、`SESSION_EXPIRED`、`EXECUTION_CONTEXT_REQUIRED` 或 `EXECUTION_CONTEXT_STALE` 时按错误指引停止盲目重试

### Requirement: Honest Sharing UI State

Sharing 对话框 MUST 分别展示 Session 是否已 Sharing 与内嵌 MCP Server 是否当前可连接。MCP Server 未启用、Token 缺失或端点未运行时，界面不得显示“服务已配置连接方式”作为确定事实；停用 MCP 或 Token 变更导致 Sharing 被清理后，Settings Workspace MUST 刷新共享列表并提示用户重新配置/Sharing。

#### Scenario: Session is shared while MCP service is stopped

- **WHEN** 用户完成 Sharing，但内嵌 MCP Server 当前未启用或没有有效 Token
- **THEN** 对话框仍可展示 Session 已 Sharing，但明确提示 MCP Server 尚未运行及需要到 MCP 服务设置配置，Share Text 不包含真实 Token

#### Scenario: Settings list refreshes after revocation

- **WHEN** 用户在 Settings Workspace 吊销 Token、重新生成 Token 或停用 MCP Server
- **THEN** 页面显示的共享 Session 列表与 Main 当前 registry 一致，不保留已失效的旧 Sharing 条目
