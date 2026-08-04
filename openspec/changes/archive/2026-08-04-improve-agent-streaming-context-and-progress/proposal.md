## Why

当前 Agent 已经从 Provider 接收 text delta，但 Core 将每个 delta 重新拼接为完整 assistant 文本后通过时间线发送，长回复会产生重复传输、重复字符串分配和重复 Markdown 解析。对话压缩目前只有确定性的截断式 fallback，长对话可能丢失跨轮目标与关键 Tool 依据；同时运行时只有完成性复核，没有可恢复、可观察的结构化任务进度。

这些限制在短对话中不明显，却会同时影响长回复性能、长任务上下文可靠性和用户对多步任务的判断。现在补齐这些契约，可以在保留原始审计记录和安全边界的前提下改善长任务行为。

## What Changes

- 新增 assistant 文本 delta 的 Core/IPC/Renderer 事件契约，支持追加、替换、顺序校验和最终历史 hydration；保留稳定时间线条目，避免每个 delta 产生独立记录。
- 新增 Provider-backed conversation summarization：在脱敏、无 Tool、独立预算下优先使用当前 Provider 生成摘要，失败或结果不合格时回退到确定性提取摘要。
- 强化确定性摘要的 token 上界与结构化证据保留，避免已有摘要重新压缩后仍超过预算。
- 新增不暴露 chain-of-thought 的结构化 Agent progress：以有界步骤、状态和 Tool evidence 表示计划进度，并在完成前执行有限的计划-证据复核。
- 扩展 Runtime checkpoint、Timeline 和历史恢复测试，确保取消、审批恢复、断连、旧客户端和摘要失败路径保持安全收敛。

## Capabilities

### New Capabilities

- `agent-delta-streaming`: 定义 assistant delta 的 Core 事件、顺序、替换语义和 Renderer 聚合行为。
- `provider-backed-context-summarization`: 定义 Provider 摘要、脱敏、预算、fallback 和持久化追踪行为。
- `structured-agent-progress`: 定义不包含隐藏推理的计划步骤、进度状态、证据关联和有界复核。

### Modified Capabilities

- `agent-execution`: 修改 Conversation Compaction 和多步 Agent Turn 的上下文、checkpoint 与完成性复核要求。
- `desktop-terminal`: 修改 Agent 时间线的流式传输与 Renderer 恢复要求。

## Impact

- 影响 `packages/model-providers`、`packages/agent-service`、`packages/application`、`packages/protocol`、`packages/ui-platform` 和 `apps/desktop` 的类型、运行时状态、IPC 事件与测试。
- 可能新增一个无副作用的 Provider 摘要 Model Run；该调用不提供 Tool，不计入用户 Tool Call 上限，但需要独立超时、取消、审计和输出预算。
- 不新增可执行 Tool，不暴露模型隐藏推理，不改变 Policy、Approval、Lease、Session 绑定、SecretRedactor 或 Audit 边界。
