## ADDED Requirements

### Requirement: Recoverable Tool Call Errors
模型可自行修正的工具调用错误（如 Schema 校验失败、参数不满足路径/长度约束）MUST 由 ToolGateway 标记为可恢复（`recoverable: true`）并附带说明原因的 `message`；AgentRuntime MUST 把该错误作为 `tool_result`（`isError: true`）回传给模型并继续下一轮规划，MUST NOT 因单次此类错误终止整个任务。同一签名连续无进展的失败调用 MUST 仍受 `agent_loop_limit_reached` 上限保护。审批失效、策略拒绝等环境性错误 MUST 保持现有终止语义，不得被本要求放宽。

#### Scenario: Invalid local file path is fed back for re-planning
- **WHEN** 模型调用 `local_read_file` 且参数含绝对路径，Schema 校验失败
- **THEN** ToolGateway MUST 返回 `recoverable: true` 的 `invalid_tool_call` 并附带字段与原因提示，AgentRuntime MUST 将错误作为 tool_result 回传模型并继续，模型可在下一轮改用相对路径重试

#### Scenario: Loop guard still terminates repeated no-progress calls
- **WHEN** 模型对同一非法调用签名连续提交且未产生新进展，超过循环上限
- **THEN** 任务 MUST 以 `agent_loop_limit_reached` 失败终止，不无限重试

#### Scenario: Environmental errors keep their failure semantics
- **WHEN** 工具调用因审批失效或策略拒绝等环境性原因失败
- **THEN** 任务 MUST 保持既有失败/暂停语义，不因可恢复机制改变
