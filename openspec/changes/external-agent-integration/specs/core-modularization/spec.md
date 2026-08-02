## ADDED Requirements

### Requirement: Modular Package Boundaries
平台实现 MUST 按分层子包组织：`domain`、`protocol`、`application`、`platform-kernel`、`agent-service`、`terminal-service`、`tooling`、`model-providers`、`infrastructure`（共享 UI 部分归 `ui-platform`）；包间依赖 MUST 从上层指向下层（apps → application/platform-kernel → agent-service/terminal-service/tooling → infrastructure → protocol → domain），反向依赖 MUST 被依赖方向约束测试阻止。

#### Scenario: Reverse dependency is rejected
- **WHEN** 某子包（如 agent-service）引入对上层包（如 application）的 import
- **THEN** 依赖方向约束测试失败，该依赖不得合入

#### Scenario: New external integration lands in a module
- **WHEN** 新增 MCP 或 ACP 代码
- **THEN** 代码位于对应入口/服务模块并只依赖公共 API，不得直接写入 PTY 或触碰 Kernel 内部状态

### Requirement: Composition Root Boundary
`apps/core` MUST 仅承担 Composition Root 职责：选择并组装具体 Agent、Terminal、Tool、Storage 与 Transport 实现；业务实现 MUST 位于对应子包，不得继续堆入 `apps/core/src`。

#### Scenario: New session logic is added
- **WHEN** 需要新增 Session 相关业务逻辑
- **THEN** 实现落入 terminal-service 子包，apps/core 只做组装与启动

#### Scenario: Existing flat files are migrated
- **WHEN** 迁移 `apps/core/src` 现有平铺实现
- **THEN** 文件按架构文档第 11 节迁移映射落入对应子包，且现有测试全量通过

### Requirement: Module Public API
每个子包 MUST 通过公共入口（index）导出契约、用例组件与必要类型；包间依赖 MUST 只引用公共 API，内部实现文件 MUST NOT 被包外直接 import。

#### Scenario: Internal file is imported from another package
- **WHEN** 其他包尝试 import 某子包的内部实现路径
- **THEN** 类型检查或依赖约束测试失败，并提示改为公共入口

### Requirement: Core API Single Entry
所有外部入口（MCP 端点、ACP 桥接及未来 CLI/Web）MUST 通过统一 Core API 调用平台能力，不得各自实现业务与安全逻辑；外部入口 MUST NOT 直接访问 PTY、Policy、Lease 或 Audit 内部实现。

#### Scenario: MCP endpoint executes a command
- **WHEN** 外部客户端经 MCP 端点请求终端执行
- **THEN** 端点调用 Core API 的会话执行用例，进入统一 Tool Pipeline，经过 Policy/Approval/Lease/Audit

#### Scenario: ACP bridge bypasses the API
- **WHEN** ACP 桥接尝试绕过 Core API 直接写入 PTY
- **THEN** 进程边界与模块约束拒绝该写入并记录安全审计

### Requirement: Replaceable Backend Verification
Agent 与 Terminal 抽象 MUST 具备契约测试：TestAgent 与 MockTerminalBackend 能替换内置实现并通过同一套用例；具体 Adapter MUST 经 Registry 注册，上层 MUST 依赖抽象而非具体实现。

#### Scenario: Terminal backend is swapped
- **WHEN** 以 MockTerminalBackend 替换本地 PTY 实现运行契约测试
- **THEN** 契约用例通过且上层无需改动

#### Scenario: Agent driver is swapped
- **WHEN** 以 TestAgent 替换内置 Agent 运行任务用例
- **THEN** 执行、审批与审计语义保持一致
