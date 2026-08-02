## Context

用户报告：让 Agent 用 `local_read_file` 读取一个绝对路径文件时，工具调用返回 `invalid_tool_call` 后整轮任务直接以"Agent 执行失败：invalid_tool_call"结束，模型没有机会改用相对路径重试。

根因追踪：
1. `tool-gateway.ts#call()` 对 `terminalToolCallSchema.safeParse` 失败返回 `{ ok: false, error: 'invalid_tool_call' }`，未设置 `recoverable` 与 `message`。
2. `agent-runtime.ts#executeCalls()` 对 `!result.ok` 的处理：虽然已经把错误作为 `tool_result` 加入 messages，但只有 `result.recoverable === true` 时才 `return { kind: 'continue' }` 继续让模型规划；否则立即 `finish('failed', ..., result.message ?? result.error)`。

因此错误信息其实已经写入上下文，但运行循环在模型看到它之前就终止了。

## Goals / Non-Goals

**Goals:**
- Schema 校验失败（模型可自行修正的参数错误）必须回传模型，让 ReAct 循环继续。
- 错误信息必须包含模型可据以修正的提示（字段 + 拒绝原因）。
- 保留防死循环上限。

**Non-Goals:**
- 不改变审批失效、策略拒绝等环境性错误的终止语义。
- 不改变外部 MCP/ACP 客户端路径（外部客户端由各自运行时自行决定重试）。
- 不引入新的 IPC/协议字段。

## Decisions

**D1：`invalid_tool_call` 标记为可恢复并带提示。**
`tool-gateway.ts#call()` 校验失败时返回：
```ts
{ ok: false, error: 'invalid_tool_call', recoverable: true, message: formatToolCallValidationMessage(parsed.error) }
```
`formatToolCallValidationMessage` 汇总 Zod issues：未知字段、缺失字段、路径约束（如绝对路径被拒）等，生成类似 `local_read_file.path: 必须是相对主目录的路径（当前值被拒绝）` 的说明。模型据此可在下一轮修正。

备选：在 AgentRuntime 对 `invalid_tool_call` 一律按 recoverable 处理。否决理由：数据应来自 ToolGateway 的语义（谁产生错误谁声明可恢复性），运行时不该猜测错误类型；且保留运行时对非 recoverable 错误的硬终止能力。

**D2：复用既有 no-progress 循环上限。**
`#recordNoProgress` 已对同签名失败调用计数，超限以 `agent_loop_limit_reached` 终止，避免模型反复提交同一非法调用无限消耗。

**D3：错误消息保持精简。**
只带首个/关键 Zod issue 的字段路径与原因，不把整个错误对象序列化进上下文，控制 token 消耗。

## Risks / Trade-offs

- [模型反复犯同样参数错误] → no-progress 上限兜底，任务最终仍会失败但已给模型机会。
- [错误信息过长] → 只汇总有限个 issue（最多 3 条），每条短句。
- [现有测试断言 `toMatchObject({ error: 'invalid_tool_call' })` 仍兼容] → 新增字段不影响子集断言；补充新断言固化 recoverable 行为。

## Migration Plan

纯行为修复，无数据迁移；直接随下一个构建发布。
