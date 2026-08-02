## MODIFIED Requirements

### Requirement: Session-Bound Agent Task
每个 Agent Task MUST 绑定一个 Ready Session；内置驱动者的 Task 还 MUST 绑定一个 Provider Profile，外部驱动者的 Task MUST NOT 需要 Provider Profile，模型选择保持为空。模型不得在 Tool 调用中改变目标 Session。

#### Scenario: Model supplies a session identifier
- **WHEN** 模型 Tool 参数包含未声明的 `sessionId`
- **THEN** Schema 校验拒绝调用且 ToolGateway 使用运行时绑定的 Session

#### Scenario: External driver task without provider profile
- **WHEN** 用户以外部驱动者创建 Agent Task
- **THEN** Task 绑定 Ready Session 且不包含 Provider Profile，模型选择字段为空

## ADDED Requirements

### Requirement: External Driver Execution Through Pipeline
外部驱动者提出的 Tool Call MUST 与内置 Agent 一样进入 ToolGateway 与统一 Command Transaction 管线，不得直接访问 PTY 或绕过 Policy/Approval/Lease/Audit；外部驱动者不依赖 AgentRuntime 的推理循环。

#### Scenario: External driver proposes terminal execute
- **WHEN** 外部驱动者请求 terminal.execute
- **THEN** 调用进入统一管线并在管线授权前不得写入 PTY

#### Scenario: External driver attempts direct PTY access
- **WHEN** 外部驱动者或其进程尝试绕过管线写入 PTY
- **THEN** 平台因进程边界与模块约束拒绝该写入并记录安全审计
