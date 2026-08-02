## MODIFIED Requirements

### Requirement: Structured Audit Events
系统 MUST 追加记录 Session、Agent Task、Tool Call、策略判断、授权、命令结果、中断、接管和错误等结构化审计事件，并为每个结构化 Shell 输入记录 transport、当前环境和 capability epoch 证据。外部调用者执行时 MUST 以"外部调用者 + Session"作为审计主体，不伪造 Task/Turn。

#### Scenario: Agent executes a command
- **WHEN** Command Transaction 从请求进入最终状态
- **THEN** 审计包含 actor、Session、Task、命令哈希、风险、Grant、时间、最终状态、transport mode、dialect/platform 和 capability epoch

#### Scenario: Environment verification fails
- **WHEN** 当前 PTY 指纹超时、歧义或明文 Probe 失败
- **THEN** 审计包含失败阶段、稳定错误码和被拒绝的 transport，且不记录 Protected Input 或伪造成功命令结果

#### Scenario: External caller executes a command
- **WHEN** 外部调用者（MCP 客户端或 ACP 外部驱动者）的 Command Transaction 完成
- **THEN** 审计包含外部调用者来源、目标 Session、命令哈希、风险、审批结果与时间，且不包含伪造的 Task/Turn 归属
