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
外部工具调用 MUST 携带 sessionId 参数；MCP 端点 MUST 拒绝未携带或携带不存在、未 Ready sessionId 的调用，且错误信息 MUST NOT 泄露其他会话信息。系统 MUST NOT 提供会话枚举、列表或发现能力。

#### Scenario: Caller supplies a valid copied id
- **WHEN** 外部调用携带用户从桌面复制的、存在且 Ready 的 sessionId
- **THEN** 端点将该调用翻译为针对该 Session 的内部作用域调用并进入 Tool Pipeline

#### Scenario: Caller supplies an invalid id
- **WHEN** 外部调用携带不存在的 sessionId
- **THEN** 端点返回稳定的"无效会话"错误，不包含任何其他会话的 id、名称或状态

### Requirement: External Approval Configuration
MCP 端点 MUST 按设置页配置的两级权限审批外部调用：read-only 模式只放行读类工具并拒绝写类；managed 模式按本地 PolicyEngine 自动放行低危并拒绝高危。高危操作 MUST NOT 可通过配置放行；未配置时 MUST 默认拒绝。

#### Scenario: Managed mode low-risk command
- **WHEN** 权限为 managed 且外部调用被 PolicyEngine 判定为低危
- **THEN** 调用自动放行并记录审批来源为配置策略

#### Scenario: High-risk command in any mode
- **WHEN** 外部调用被判定为 destructive 或 unknown 高危命令
- **THEN** 调用被拒绝，不得因任何配置被自动放行，并记录审计

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
