## Why

当模型产生一次可自行修正的工具调用错误（典型如 `local_read_file` 传了绝对路径、`terminal_execute` 附带非法字段）时，ToolGateway 返回的 `invalid_tool_call` 缺少 recoverable 标记，AgentRuntime 直接把整轮任务置为失败（"Agent 执行失败：invalid_tool_call"），错误没有作为 tool_result 回传给模型，模型无法按 ReAct 语义重新规划（例如改用相对路径重试）。

## What Changes

- ToolGateway 对 Schema 校验失败返回 `recoverable: true` 并附带可读的修复提示 `message`（说明哪个字段、为什么被拒绝）。
- AgentRuntime 对 recoverable 的工具错误按既有路径把错误作为 `tool_result`（`isError: true`）回传模型并继续下一轮，而不是终止任务。
- 保留既有防死循环机制：同一签名连续无进展的工具调用仍受 `agent_loop_limit_reached` 上限保护。
- 审批失效、策略拒绝等环境性错误保持现有语义，不因本次变更变为可恢复。

## Capabilities

### New Capabilities

### Modified Capabilities
- `agent-execution`: 新增"可恢复工具调用错误"要求，规定模型可修正的参数错误必须回传模型重规划。

## Impact

- `packages/platform-kernel/src/gateway/tool-gateway.ts`：`call()` 校验失败分支返回 recoverable 与 message。
- `packages/agent-service/src/runtime/agent-runtime.ts`：无需逻辑改动，既有 recoverable 分支被新数据驱动；必要时补充说明。
- 测试：`tool-gateway.test.ts` 新增校验失败断言；`agent-runtime.test.ts` 新增 invalid_tool_call 回传继续的集成测试。
- 无 IPC、协议或 UI 变更。
