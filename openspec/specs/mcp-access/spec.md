# mcp-access Specification

## Purpose
规定桌面内嵌 MCP Server 的本机访问、Session 寻址、权限策略、事务审计、工具 Schema 隔离和输出脱敏边界。

## Requirements

### Requirement: Embedded MCP Endpoint
MCP server MUST 作为桌面应用内嵌模块运行，仅监听本机回环地址，并在设置中提供启用/禁用开关。MCP 端点 MUST 使用可吊销且无过期的 Bearer token 认证，token 由设置页生成与吊销，吊销后所有未完成调用 MUST 被拒绝。

#### Scenario: Enable MCP endpoint in settings
- **WHEN** 用户在设置中启用 MCP Server 并复制连接串（回环地址 + token）粘贴到外部客户端
- **THEN** 外部客户端可通过该连接串调用暴露的工具，且端点只监听回环地址

#### Scenario: Token revoked
- **WHEN** 用户在设置页吊销当前 token 后外部客户端继续调用
- **THEN** 所有新调用 MUST 返回认证失败，已建立的 MCP 连接不得继续执行工具

### Requirement: External Session Addressing
外部工具调用 MUST 携带 sessionId 参数；MCP 端点 MUST 拒绝未携带或携带不存在、未共享、PTY 已退出 sessionId 的调用，并 MUST 返回稳定错误码 `SESSION_EXPIRED`，同时附带“请在桌面端重新复制并共享会话 ID”的恢复指引；会话存在且 PTY 运行但 Shell 未就绪时，执行类调用 MUST 返回稳定错误码 `SESSION_NOT_READY` 并附带可重试指引。错误信息 MUST NOT 泄露其他会话信息。系统 MUST NOT 提供会话枚举、列表或发现能力。

#### Scenario: Caller supplies a valid copied id
- **WHEN** 外部调用携带用户从桌面复制的、存在且 Ready 的 sessionId
- **THEN** 端点将该调用翻译为针对该 Session 的内部作用域调用并进入 Tool Pipeline

#### Scenario: Caller supplies an invalid id
- **WHEN** 外部调用携带不存在的 sessionId
- **THEN** 端点返回稳定错误 `SESSION_EXPIRED` 与重新共享指引，不包含任何其他会话的 id、名称或状态

#### Scenario: Session shell is not ready
- **WHEN** 外部执行类调用到达且会话存在、PTY 运行但 Shell 未就绪
- **THEN** 端点返回稳定错误 `SESSION_NOT_READY` 与稍后重试指引，客户端可重试或先探测会话状态

### Requirement: Stable External Error Codes
所有 `terminal_*` 工具的错误结果 MUST 以稳定、可解析的错误码开头返回：会话未就绪为 `SESSION_NOT_READY`，会话不存在/未共享/PTY 已退出为 `SESSION_EXPIRED`，外部租约不可用为 `SESSION_BUSY`，事务不存在为 `TRANSACTION_NOT_FOUND`；其余业务错误 MUST 保留原有内部稳定码（如 `POLICY_DENIED`、`COMMAND_NOT_FOUND`、`COMMAND_FAILED`）。错误文本 MUST 同时包含错误码、原因说明与客户端应采取的下一步。MUST NOT 返回“unsupported call”或依赖客户端猜测的错误形态。

#### Scenario: Execute fails while shell is probing
- **WHEN** 客户端调用 `terminal_execute` 且 Shell 正在探测或未就绪
- **THEN** 错误结果以 `SESSION_NOT_READY` 开头，并包含“稍后重试或调用 terminal_status 探测状态”的指引

#### Scenario: Session expired after terminal exits
- **WHEN** 终端 PTY 已退出、会话已被移除或用户取消了共享，客户端继续调用 `terminal_*`
- **THEN** 错误结果以 `SESSION_EXPIRED` 开头，并包含“在桌面端重新复制并共享会话 ID”的指引

### Requirement: External Session Status Probe
MCP 端点 MUST 提供只读探测工具 `terminal_status`，接收单个 sessionId，返回会话状态 `ready`、`not_ready` 或 `expired`，并附带可用的 PTY/Shell 状态与恢复指引。`terminal_status` MUST 对不存在的会话返回 `expired` 而非抛错，MUST NOT 提供会话列表或遍历能力，MUST NOT 创建租约或写入 PTY。会话从 `not_ready` 恢复为 `ready` 后，既有 `terminal_execute` / `terminal_observe` / `terminal_wait` 工具 MUST 可直接继续使用。

#### Scenario: Probe an expired session
- **WHEN** 客户端在会话失效后调用 `terminal_status`
- **THEN** 工具返回 `status: 'expired'` 与重新共享指引，客户端据此停止重试并提示用户重新共享

#### Scenario: Probe a recovering session
- **WHEN** 客户端在 Shell 未就绪期间调用 `terminal_status`，随后会话恢复
- **THEN** 第一次返回 `status: 'not_ready'` 与重试指引；会话恢复后再次调用返回 `status: 'ready'`，执行类工具可继续使用

### Requirement: Expired Session Registration Cleanup
当外部调用发现会话不存在、未共享或 PTY 不在运行状态时，MCP 端点对应的外部调用处理层 MUST 判定该会话已失效，清理该会话缓存的执行管线注册，并让客户端明确知道需要重新共享会话。失效会话不得残留可被后续调用复用的旧执行器或租约状态。

#### Scenario: Session removed while pipeline is cached
- **WHEN** 终端 PTY 退出导致会话从会话管理器移除，客户端再次调用 `terminal_*`
- **THEN** 调用返回 `SESSION_EXPIRED`，且该会话的缓存管线被清理，后续以相同 id 重建的会话使用全新管线

### Requirement: External Tool Surface
MCP 端点 MUST 只暴露 `terminal_execute`、`terminal_observe`、`terminal_wait`、`terminal_interrupt` 与 `terminal_status` 五个终端工具，MUST NOT 暴露 `local_*` 文件工具。文件能力仅通过内部 Core API（`external.local*`）保留给 ACP 等非 MCP 通道。

#### Scenario: Tools list contains only terminal tools
- **WHEN** 外部客户端请求 `tools/list`
- **THEN** 返回的工具集 MUST 仅包含 `terminal_*` 工具，不含 `local_list_files`、`local_search_files`、`local_read_file`

#### Scenario: ACP file capability remains available
- **WHEN** ACP 驱动者通过内部通道调用 `external.localReadFile`
- **THEN** 该能力 MUST 不受 MCP 工具面收敛影响，仍可正常使用

### Requirement: External Approval Configuration
MCP 端点 MUST 按设置页配置的三级权限审批外部调用：read-only 模式只放行读类工具并拒绝写类；managed 模式按本地 PolicyEngine 自动放行低危并拒绝高危；full 完全权限模式不审查命令，任何风险级别的命令 MUST 自动放行。未配置或配置无效时 MUST 默认回退 read-only 拒绝。

#### Scenario: Managed mode low-risk command
- **WHEN** 权限为 managed 且外部调用被 PolicyEngine 判定为低危
- **THEN** 调用自动放行并记录审批来源为配置策略

#### Scenario: High-risk command in managed or read-only mode
- **WHEN** 权限为 managed 或 read-only 且外部调用被判定为 destructive 或 unknown 高危命令
- **THEN** 调用被拒绝，不得自动放行，并记录审计

#### Scenario: High-risk command in full mode
- **WHEN** 用户在设置页显式选择 full 完全权限模式且外部调用提交任意风险级别的命令
- **THEN** 调用自动放行并记录审计（含 risk 与 approvalMode: full），策略引擎只用于审计分类，不拦截执行

#### Scenario: Invalid approval configuration
- **WHEN** 设置文件缺失、损坏或包含未知的审批模式值
- **THEN** 设置加载回退为 read-only，外部写类调用默认被拒绝

### Requirement: External Session Status Semantics
`terminal_status` MUST 在会话存在、已共享且 PTY 运行时返回 `ready` 或 `not_ready`，并 MUST 按 Shell 状态返回可执行的恢复指引；`shell: unknown` MUST 提示“执行一次 terminal_execute 自动探测”，不得提示等待用户完成初始化。用户复制 sessionId 共享会话后，系统 SHOULD 自动运行一次 Shell 探测，使 Shell 状态尽快推进到 `ready`；探测因用户占用或超时失败时 MUST NOT 影响共享流程或阻塞调用。

#### Scenario: Newly shared session with an unknown shell
- **WHEN** 用户复制 sessionId 共享一个 `shell: unknown` 的会话，随后外部客户端调用 terminal_status
- **THEN** 若自动探测已成功，状态为 ready；若探测尚未完成或失败，状态为 not_ready 且 hint 说明执行一次 terminal_execute 即可自动探测

#### Scenario: Auto probe succeeds after sharing
- **WHEN** 会话共享时 Shell 未就绪且外部租约可获取
- **THEN** 系统自动运行 ShellProbe，Shell 状态推进到 ready，且不阻塞共享响应

#### Scenario: Auto probe cannot acquire the lease
- **WHEN** 用户正占用终端导致自动探测无法取得外部租约
- **THEN** 共享流程正常返回，会话保持未探测状态，后续 terminal_execute 的懒探测仍可使其就绪

### Requirement: External Command Transaction Semantics
每个外部执行调用 MUST 作为独立 Command Transaction 进入统一 dispatch，申请 JIT Lease，并遵守现有 epoch、明文传输、完成证据和审计约束；用户接管 MUST 立即使其失效。

#### Scenario: User takes over during external execution
- **WHEN** 外部调用正在执行且用户进行接管
- **THEN** Lease epoch 递增、外部执行令牌失效，后续外部调用必须重新获取 Lease

#### Scenario: Concurrent external and built-in execution
- **WHEN** 内置 Agent 正持有 Session Lease 时外部调用到达
- **THEN** 外部调用 MUST 等待或拒绝，不得与内置 Agent 并发写入同一 PTY

### Requirement: External Caller Audit Identity
外部调用 MUST 以"外部调用者 + Session"作为审计主体，不得伪造 Agent Task 或 Turn；审计 MUST 记录来源（MCP）、sessionId、命令哈希、风险、审批结果与时间。

#### Scenario: Audit entry for an external call
- **WHEN** 外部调用完成或被拒绝
- **THEN** 审计事件包含 external-caller 来源、目标 Session、命令哈希与审批结果，且不创建任何 Task/Turn 记录

### Requirement: External Tool Schema Isolation
内部 Agent 工具 Schema MUST 保持不含 sessionId；MCP 端点 MUST 在边界层将带 sessionId 的外部形态翻译为内部按会话作用域调用，外部形态不得进入领域层。

#### Scenario: Internal schema remains unchanged
- **WHEN** 外部客户端使用带 sessionId 的工具形态调用
- **THEN** 领域层与内置工具 schema 仍无 sessionId 字段，翻译只发生在端点层

### Requirement: External Observe Redaction
terminal_observe 对 MCP 外部调用 MUST 视为读操作并可按权限放行，返回内容进入外部调用者前 MUST 经过现有脱敏管线。

#### Scenario: Observe output contains a secret
- **WHEN** 外部调用 observe 且输出命中 secret 检测规则
- **THEN** 外部调用者收到脱敏结果，本地终端显示不被替换

### Requirement: Stable Loopback Port
MCP 端点 MUST 在首次启用时确定监听端口并持久化到设置；后续启用、停用再启用或应用重启 MUST 复用同一端口。首选端口被占用时 MUST 回退到临时端口，并将实际端口持久化，下一次启动继续复用回退后的端口。设置页展示的连接串 MUST 始终反映当前实际监听端口。

#### Scenario: Port survives disable and re-enable
- **WHEN** 用户启用 MCP Server 后停用，再重新启用
- **THEN** 两次启用的监听端口 MUST 相同，连接串不变

#### Scenario: Port survives an application restart
- **WHEN** 应用退出后重新启动且 MCP 设置仍为启用
- **THEN** 端点 MUST 使用持久化端口监听，连接串与上次一致

#### Scenario: Preferred port is occupied
- **WHEN** 首次启用的默认端口已被其他进程占用
- **THEN** 端点 MUST 回退到可用临时端口继续运行，并把实际端口写入设置供后续复用
