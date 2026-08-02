# ADR-0024：外部调用使用普通命令事务和独立审计身份

状态：已实现

## 决策

MCP/ACP 的每次执行都走普通 Command Transaction：获取 JIT 外部租约，与用户和内置 Agent 输入互斥，执行相同的 ShellDriver/策略，并用外部调用者身份审计，而不是伪造 Agent Task 或 Turn。

## 当前实现

`ExternalToolPipeline`、`ExternalRequestHandler` 和 `CommandExecutor` 共同处理 `caller.kind = mcp | acp`、Lease epoch、审批、结果和审计。

## 影响

外部客户端和内置 Agent 共享终端安全语义，但外部调用不会自动拥有内置 Conversation 的模型上下文或历史。
