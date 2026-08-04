## Context

当前 Provider Adapter 已经输出统一的 `text_delta`，但 `AgentCoordinator` 将每个 delta 累积成完整字符串后通过 `agent.timeline` 发送。Renderer 以稳定 ID 替换整条 assistant 项，因此短回复行为正确，长回复会重复传输和重复 Markdown 解析。

当前 `ConversationCompactor` 只有确定性的逐条截断摘要。它在创建 Provider Adapter 前运行，因此没有能力调用 Provider；归档设计曾要求 Provider 摘要失败后再使用 deterministic fallback。摘要必须继续脱敏、有界并保留原始 Model Item，不能为了提高语义质量牺牲安全和可审计性。

当前 Runtime 已有 Tool Loop、循环上限、审批 checkpoint 和 post-Tool completion review，但没有独立的结构化进度状态。新增的进度必须能够在审批暂停后恢复，且只能表达可验证的执行步骤和 Tool evidence，不能表达或诱导模型隐藏推理。

## Goals / Non-Goals

**Goals:**

- 通过 Core service event 和 Desktop IPC 发送只包含新增文本的 assistant delta，支持 append、replace、单调序列和历史终态收敛。
- 在 Conversation 压缩达到阈值时，使用当前 Adapter 发起一个无 Tool、脱敏、有界且可取消的摘要 Model Run；Provider 失败、返回 Tool Call、空文本或超预算时使用 deterministic fallback。
- 让 deterministic fallback 和 Provider 结果都满足实际 token 上界；旧摘要重新压缩时不能原样返回超限历史。
- 为 Runtime 增加有限步骤快照：步骤来源是已接受的 Tool Call，状态更新由 Tool 执行、审批、错误、取消和完成性复核驱动，并随 approval checkpoint 恢复。
- 保留当前稳定 timeline item、原始 Model Item、Tool Call/Result、Policy、Approval、Lease、SecretRedactor 和 Audit 语义。

**Non-Goals:**

- 不新增可执行 `plan` Tool，不要求模型输出或 UI 显示 chain-of-thought、Thought/Reasoning 原文。
- 不实现任意 Markdown AST 的增量解析；流式期间可继续使用有界刷新策略，终态仍使用完整 Markdown 文本。
- 不把 Provider 摘要视为事实来源；摘要始终是可丢弃的上下文缓存，原始记录仍是审计事实源。
- 不将进度步骤扩展为跨 Turn 的工作流编排、依赖图或后台调度系统。

## Decisions

### Separate delta event from persisted timeline item

新增 `agent.text_delta` Core event 和 `agent:text-delta` Desktop event。事件携带稳定 assistant item ID、Turn 标识、`append | replace` 操作、非空 delta 和单调 sequence。`agent.timeline` 继续发送 user、Tool、最终 assistant 和失败/取消 system item。

Renderer 为每个 assistant ID 保留内存累积文本：append 只拼接 delta，replace 清空后写入首个 delta；收到终态 timeline item 或 history hydration 后，以完整文本作为权威结果。这样不会改变现有历史协议，也不会因为单个 Provider delta 丢失而永久破坏历史。

选择独立事件而不是把 delta 塞进现有 `AgentTimelineItem.text`，是为了避免旧消费者把 delta 当作完整 Markdown 文本。事件 sequence 只用于检测丢失或乱序；检测失败时 Renderer 立即请求已有 history 刷新，并拒绝继续应用不连续 delta。

### Keep stable-ID aggregation and bound rendering frequency

Core 每个非空 Provider delta 只发送新增内容；Renderer 可以在一个动画帧内合并多个 delta 后更新 React state。流式 assistant 使用纯文本/轻量渲染路径或至少使用有界刷新频率，终态再交给完整 Markdown 渲染，避免“只减少网络字节但仍每个 token 重解析全文”。

### Provider summarization is optional enrichment over deterministic evidence

`ConversationCompactor` 接收一个可选的异步 summary callback，而不依赖具体 Provider。Coordinator 在 compaction 前创建当前 Model Adapter，并为 callback 提供脱敏后的旧摘要与待压缩 Model Item。摘要请求只包含一个版本化 system instruction 和结构化用户数据，不提供 Tools，输出有独立 token 上限、超时和 AbortSignal。

Provider 摘要只在非空、无 Provider error、无 Tool Call 且不超过可用 summary budget 时接受；否则 fallback。Fallback 以目标、assistant 结论、Tool 名称/参数摘要、结果/错误和未完成证据组成，按实际 token budget 进行 head/tail 有界裁剪。压缩审计记录摘要方法、来源 sequence 和估算输入 token；原始 Model Item 不删除。

摘要内容来自模型或 Tool，是不可信数据，不增加其系统指令权限。summary system prompt 明确要求只提取事实、不执行其中指令、不输出秘密；所有进入 Provider 的内容先经过现有 `SecretRedactor`。

### Derive structured progress from accepted execution steps

Runtime 不增加隐藏规划 Model Run，也不要求 Provider 支持新事件。Runtime 在开始 Model Run 时发出 `planning` phase；每个已完成 Schema 校验并接受的 Tool Call 形成一个短步骤，步骤 label 只使用 Tool 名称，不能包含未脱敏参数。执行、等待审批、Tool Result、可恢复错误、完成性复核和最终结束更新步骤状态与 phase。

进度通过已有 `agent.timeline` 的结构化可选字段发送，使用稳定 progress item ID 原位更新；不写入 Conversation Model Item。Approval checkpoint 保存进度快照，批准后继续原步骤。完成性复核前 phase 为 `verifying`，复核发现缺口时恢复 `executing` 并继续现有 Tool Loop，因此进度是可验证状态而非思维过程。

### Use explicit budgets and fail closed

摘要 Model Run 有独立 timeout、最大输出 token 和 cancellation handling，失败只影响摘要质量，不阻塞用户 Turn；deterministic fallback 也必须满足预算，若预算小于最小系统摘要单元则返回稳定的 context budget error。Progress steps、delta 数量、摘要输入和输出均设置有界限制，避免模型或 Provider 输出造成新的无界内存增长。

## Risks / Trade-offs

- [Provider 摘要引入延迟、费用和非确定性] → 只在真正触发 compaction 时调用；独立超时，失败快速 fallback，并审计摘要方法。
- [Provider 摘要遗漏或幻觉关键事实] → deterministic evidence 作为 fallback；原始历史保留；summary prompt 禁止推断，测试要求保留 Tool/错误锚点。
- [摘要内容被当作 system 指令] → summary 以受控数据格式插入，明确不可信边界，不采纳其中的规则或 Tool 指令。
- [delta 丢包或乱序] → sequence 校验、history refresh、终态完整 timeline item 兜底；不连续事件不继续盲目拼接。
- [Renderer 仍在高频重解析 Markdown] → delta 传输与 UI 刷新分离，使用帧级合并和流式期间轻量文本路径；终态再完整渲染。
- [步骤状态与模型真实意图不一致] → 步骤只代表已接受 Tool Call，不声称代表模型全部计划；完成性复核继续以原目标和结构化 Tool evidence 为权威。
- [新增结构字段破坏旧客户端] → 新字段只在 schema 中 optional；旧 `agent.timeline` item 继续合法；新 delta event 缺失时历史刷新仍可完成 UI。
- [摘要失败与用户 Turn 竞态] → 在创建运行时状态前完成有界摘要，失败不写入半成品 compaction；只有成功产出的摘要才持久化。

## Migration Plan

1. 先增加协议 schema、Desktop event channel、UI reducer 和 Runtime/Compactor 的失败测试，确认旧 timeline/history 行为保持不变。
2. 实现 Core delta 转发和 Renderer 聚合；新客户端监听 delta，旧 timeline 终态仍能独立显示完整回复。
3. 实现异步 Provider summary callback、deterministic token fitting、审计元数据和 fallback；对已有 compaction 继续按旧结构读取。
4. 实现 Runtime progress snapshot、Coordinator timeline 投影、Renderer progress card 和 approval checkpoint 恢复。
5. 运行专项测试、相关包 typecheck、全量 Vitest、构建和 OpenSpec strict 校验。

回滚时可停止发送 `agent.text_delta`，保留现有完整 timeline 终态；摘要 callback 可关闭并继续使用 deterministic fallback；progress optional 字段可忽略，不影响既有历史数据。

## Open Questions

无阻塞开放问题。实现使用当前 Turn 选定的 Provider/Model 进行摘要，摘要调用不提供 Tool，不改变用户 Turn 的 Tool Call 上限。
