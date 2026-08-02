## MODIFIED Requirements

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

## ADDED Requirements

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
