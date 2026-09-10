## MODIFIED Requirements

### Requirement: Cursor-Paginated External Observation

输出可用时，`synapse_observe` MUST 支持对当前 Sharing 输出边界内的 PTY 输出历史进行不改变历史的分页读取。调用 MUST 支持可选的 `afterCursor`、互斥的 `tail` 和受服务端上限约束的 `maxBytes`；响应 MUST 返回 `nextCursor` 与 `hasMore`，历史超出保留窗口时 MUST 返回 `historyTruncated` 和 `earliestCursor`。

#### Scenario: First observation without a cursor

- **WHEN** 输出可用，外部客户端首次调用 `synapse_observe` 且未提供 `afterCursor`
- **THEN** 系统 MUST 从当前 Sharing 边界内最早可读的位置返回不超过请求页大小的内容，并返回可用于下一页的 `nextCursor`

#### Scenario: External client continues from a cursor

- **WHEN** 输出可用，外部客户端将上一次响应的 `nextCursor` 作为 `afterCursor` 再次调用 `synapse_observe`
- **THEN** 系统 MUST 只返回该位置之后的历史，并且不得消费、删除或锁定这段历史

#### Scenario: External client requests the recent tail

- **WHEN** 输出可用，外部客户端调用 `synapse_observe` 并传入 `tail: true`
- **THEN** 系统 MUST 返回当前 Sharing 边界内最近一页可读内容和当前执行上下文 ID，且 `tail` 与 `afterCursor` 同时出现时 MUST 拒绝调用

#### Scenario: History is outside the retention window

- **WHEN** 输出可用，外部客户端提供的 `afterCursor` 早于当前输出保留窗口
- **THEN** 系统 MUST 明确返回 `historyTruncated: true` 和可重新同步的 `earliestCursor`，不得用头尾摘要伪装成完整连续历史

#### Scenario: Observation is requested after protocol desynchronization

- **WHEN** 调用通过 Sharing 与身份检查，但 Session 因本地协议失同步已标记输出不可用
- **THEN** `synapse_observe` MUST 返回 `SESSION_OUTPUT_UNAVAILABLE` 和本地恢复指引，不返回新的执行上下文，不用空页或 `historyTruncated` 冒充正常观察

### Requirement: Sanitized External PTY History

对外 PTY 输出历史 MUST 在分页之前完成协议帧隔离、自动 Probe 隔离和输出脱敏。外部客户端 MUST 只收到清理后的文本，不得收到原始 PTY 字节流、OSC 777 控制帧、自动 Probe 原文、未回显的原始按键或 ANSI 屏幕快照。

文件协议、载荷和内部快照 MUST 在脱敏与分页前隔离，普通明文命令回显及可读结果遵循 Sharing 输出边界。半帧、取消与迟到载荷不得通过清理回灌历史。

#### Scenario: Probe and control frames are excluded

- **WHEN** PTY 输出包含用户文本、自动 Probe 回显和 OSC 777 完成帧
- **THEN** 外部历史 MUST 只包含协议隔离后的普通可读文本，Probe 回显和控制帧不得作为分页内容返回

#### Scenario: Secret crosses a page boundary

- **WHEN** 疑似凭据文本跨越内部输出块或外部响应页边界
- **THEN** 系统 MUST 先在连续历史上完成脱敏，再按 `afterCursor` 和 `maxBytes` 分页，不得因分页边界泄露凭据片段

#### Scenario: Observe a normal local transfer

- **WHEN** 外部客户端在正常本地传输期间观察已 Sharing Session
- **THEN** 普通脱敏文本 MUST 仍可读取，文件载荷、协议及内部快照不得出现在分页或即时输出

#### Scenario: A readable local command is echoed

- **WHEN** Sharing 之后回显明文文件操作或采集命令
- **THEN** 这些普通文本 MUST 按既有规则进入脱敏历史，不承诺仅对桌面用户可见

### Requirement: Honest External Session Status

`synapse_status` MUST 只检查调用方提供的单个 `sessionId`，不得创建外部 Lease 或写入 PTY。Session 不存在、未 Sharing、PTY 尚未运行、PTY 已退出或 Sharing 已失效时 MUST 返回 `status: expired`；PTY 运行但 current PTY environment 未验证或不完整时 MUST 返回 `status: not_ready`；PTY 运行且 dialect、platform 和 verificationStatus 均已验证时 MUST 返回 `status: ready`。返回值可以包含受限的 `environment` 摘要（仅含 dialect、platform、verificationStatus）、`readinessReason` 和 active transaction 信息，但不得返回 Token、Lease、capability epoch、`executionContextId` 或其他 Session 列表。`readinessReason` MUST 只描述本地 PTY 生命周期、当前环境验证或用户接管事实，不得声称远程主机、SSH 阶段或连接拓扑。`not_ready` 的 guidance MUST 明确 status 是只读快照、不会触发 Probe；输出可用且用户已确认回到 Shell 时，外部客户端先观察再请求执行，由执行管线验证当前环境。协议失同步时 MUST 返回 `not_ready`，guidance 明确要求用户新建 Session，不建议执行或循环 Probe；status 本身不写入 PTY。

#### Scenario: Running Session without verified environment

- **WHEN** 外部客户端对已 Sharing 且 PTY running、但 current PTY environment 尚未验证且输出可用的 Session 调用 `synapse_status`
- **THEN** 返回 `status: not_ready`、可重试的 guidance 和未验证的 environment 摘要，不得声称 ready；guidance MUST 告知外部客户端重复调用 status 不会触发 Probe，确认回到 Shell 后先 observe 再请求执行

#### Scenario: Verified POSIX environment

- **WHEN** 外部客户端对已 Sharing 且 current PTY environment 已验证为 POSIX/unix 的 Session 调用 `synapse_status`
- **THEN** 返回 `status: ready` 和 `environment.dialect: posix`、`environment.platform: unix`，且响应不得包含 `executionContextId`

#### Scenario: Unknown or expired Session status

- **WHEN** 外部客户端使用不存在、未 Sharing 或已退出的 `sessionId` 调用 `synapse_status`
- **THEN** 返回 `status: expired` 和重新 Sharing 指引，且响应不包含其他 Session 的 id、名称、状态或存在性信息

#### Scenario: PTY is not externally shareable

- **WHEN** 外部客户端使用不存在、未 Sharing、正在启动或已退出的 `sessionId` 调用 `synapse_status`
- **THEN** 返回 `status: expired` 和重新 Sharing 指引，且响应不包含其他 Session 的 id、名称、状态或存在性信息

#### Scenario: Status reports an unavailable output channel

- **WHEN** 调用通过 Sharing 与身份检查，PTY 仍运行但本地协议失同步使输出不可用
- **THEN** 状态 MUST 为 `not_ready`，说明本地输出无法安全使用，不推断远程主机状态或建议自动发送探针

## ADDED Requirements

### Requirement: Local Capabilities Do Not Expand Sharing Authorization

Sharing MUST 不向外部客户端授予本地文件引用、协议载荷、快照结构或操作句柄。三档审批和统一输出脱敏 MUST 保持。本地操作与 Sharing 的生命周期 MUST 独立；取消 Sharing、停用 MCP 或吊销 Token 仅撤销外部能力，Session 关闭清理两者。

#### Scenario: Unshare during a local upload

- **WHEN** 用户在本地上传期间取消 Sharing 或吊销 Token
- **THEN** 外部调用 MUST 失效，本地上传继续，不被外部清理中断

### Requirement: Unavailable Output Rejects External Automation

外部调用 MUST 先执行 Sharing 与调用方身份检查，不得通过输出可用性暴露未授权 Session 的状态。通过检查后，已标记输出不可用的 Session MUST 在任何自动 Probe、命令或中断写入前拒绝外部自动化，并返回 `SESSION_OUTPUT_UNAVAILABLE`；状态查询仍按只读状态契约返回。该错误不等同于审批拒绝、Session 未共享或历史保留窗口截断。重新 Sharing、Token 轮换和新外部客户端 MUST NOT 清除该 Session 的失同步状态。

#### Scenario: A caller retries after re-sharing

- **WHEN** 输出不可用的 Session 重新 Sharing，外部客户端尝试观察或执行
- **THEN** 系统 MUST 保持稳定输出不可用错误，不返回载荷或可执行上下文，不向 PTY 写入

#### Scenario: An unavailable Session is no longer shared

- **WHEN** 用户取消 Sharing 后，外部客户端仍请求该输出不可用 Session
- **THEN** 系统 MUST 按 Sharing 失效规则拒绝，不能返回输出状态；status MUST 返回 `expired`
