# ADR-0007：无法证明只读的命令需要审批

状态：已实现

## 决策

只有确定性规则能够证明为 `read_only` 的命令才可自动放行。未知、有歧义、变更、特权和破坏性命令不能依赖模型自报标签绕过审批。

## 当前实现

`@synapse-term/platform-kernel` 的 Policy Engine 在 `ToolGateway` 中执行，风险分类覆盖 `read_only`、`mutating`、`unknown`、`privileged` 和 `destructive`。

## 影响

策略可能有误报，但风险边界不会因为模型输出变化而扩大。外部 MCP/ACP 调用也复用同一分类和 fail-closed 管线。
