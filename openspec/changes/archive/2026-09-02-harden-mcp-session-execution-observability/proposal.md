## Why

当前内嵌 MCP Server 的外部客户端难以区分“没有新输出”“输出已经被截断”和“命令结果无法确认”，也无法证明一次命令执行仍基于最近观察到的 Session 状态。对于 SSH 升级、服务重启、安装和删除等操作，过时上下文可能让 Agent 把命令写入错误的当前 Shell，断线后盲目重试还可能造成重复影响。

本变更将已共享 Session 的输出观察、执行前提和事务收敛统一为可恢复、可校验的外部调用契约，同时保持 Session 传输无关、本地单用户、不持久化和用户输入不锁定的产品边界。

## What Changes

- 为 `synapse_observe` 增加 Session 级 PTY 输出历史和游标分页，支持 `afterCursor`、`tail`、`maxBytes`、`nextCursor`、`hasMore`、`historyTruncated` 与 `earliestCursor`。
- 以当前 Sharing 建立输出边界；Sharing 之前的内容不对外回放，历史只在当前应用运行期保留。
- 对外只提供协议隔离、清理和脱敏后的文本，不提供原始 PTY 字节流、自动 Probe 原文或屏幕快照。
- 为 `synapse_observe`、`synapse_execute` 和 `synapse_wait` 增加 `executionContextId` 传递；`synapse_execute` **BREAKING** 要求携带 `expectedContextId`。
- 在 Probe、审批和 PTY 写入前执行上下文再验证；上下文失配时返回稳定错误且不得写入用户命令。
- 明确 `running`、`completed`、`interrupted`、`unknown` 事务语义；等待超时不结束事务，无法确认结果时禁止自动重试。
- 保持每个 Session 单一外部事务、固定完成 Probe、用户本地输入可用和现有三档审批模式。
- 为风险结果补充置信度、判定原因和确认要求；风险判断不主动推断远程主机权限、资源影响或回滚条件。
- 对已知交互式命令返回 `INTERACTIVE_COMMAND_UNSUPPORTED`；不引入远程 PID、进程组或 SSH/容器拓扑模型。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `mcp-session-sharing`: 修改 Session 状态、PTY 输出观察、Sharing 输出边界和外部工具返回契约。
- `mcp-access`: 修改 `synapse_*` 工具参数、状态/错误语义、事务等待与风险结果。
- `literal-shell-audit`: 修改完成证据缺失、交互式命令和事务不确定态的外部行为。
- `current-pty-environment`: 修改环境失效后的执行前提校验和 Probe/写入前再验证边界。

## Impact

- 主要影响 `packages/terminal-service` 的 Session 输出历史、CommandExecutor、ShellProbe 和事务类型，以及 `apps/desktop/src/main/mcp` 的工具管线、MCP Schema、错误映射和 Sharing registry。
- 需要更新 `Share Text`、外部调用类型、Renderer/Main IPC 合约（如现有实现暴露相关字段）以及 MCP 回归测试和长输出/竞态测试。
- 这是一次包含工具 Schema 变化的兼容性变更：旧的 `synapse_execute` 调用若不提供执行上下文 ID 必须安全拒绝，不能静默降级为无校验执行。
- 不新增持久化、远程服务、主机资产、凭据存储或集中审计日志；屏幕快照和原始 PTY 流留作后续独立变更。
