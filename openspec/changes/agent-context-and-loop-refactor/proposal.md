## Why

内置 Agent 当前的上下文治理与循环控制存在结构性缺口：超大 `tool_result` 被 `fitItems` 头尾截断造成信息销毁，模型只能重跑命令付第二次代价；单阈值压缩没有 Preflight/Reactive 闸门，命中 `context_length_exceeded` 时整个任务直接失败；卡循环仅有单路径 `{name,arguments,result}` 签名比对且阈值 3 即硬失败，既不区分错误预算也不区分成功后冗余；`progress.phase='planning'` 只是 UI 相位标签，没有真实任务分解。这些缺口已开始限制复杂终端任务的可靠性，需结合《AI Agent Book》第 35/36/37/43/10/40/11 章的最佳实践进行重构。

## What Changes

- **新增 ToolResultSpiller（Ch36）+ `context_recall` 工具**：超大 `tool_result` 用头尾 Preview + `[spilled:toolCallId, re-issuable|not-replayable]` 指针替换，按工具可重发性分级外溢策略（可重发工具激进溢、有副作用命令保守溢）。**新增第 10 个工具 `context_recall`**：模型凭指针召回被外溢原始结果的指定片段（从 append-only `#items` 按切片查，受 `maxBytes` 上限），使 `not-replayable` 工具结果也可取回。Seen set 改"防全量回灌"语义——不阻止显式召回，只阻止投影路径全量回灌。
- **持久化分层与外溢状态（Ch40 精神延伸）**：新增 `ContextGovernanceState` 持久化记录（conversationId + spillRecords + tierClassifications + seenToolCallIds），原始结果内容不冗余存（仍在 `#items`），只持久化元数据 + 小 preview。崩溃恢复时 Governor 从持久化状态重建，**不重新分类、不重新外溢**（分类可能调过摘要器，重付不可接受）。
- **解除历史 ADR 自我设限**（历史 ADR 在"对 agent 还不够理解"时定的天花板）：加 `context_recall` 正面扩 Restricted Terminal Tools allowlist；顺手修预存 spec/code drift——现有 `agent-execution` spec 的 "Restricted Terminal Tools" 只授权 7 个工具，未提 `local_write_file`/`local_edit_file`（代码里已存在），本 Change 一并登记对齐。`context_recall` 是只读上下文管理工具（只查本会话历史，不碰 PTY/文件系统/Provider keys），副作用安全仍由 approval/lease/audit 第一道防线兜底。
- **新增 ThreeGateCompactor（Ch35）**：Proactive（估算 0.90）/ Preflight（发送前 0.95）/ Reactive（命中 `context_length_exceeded` 后 never-reset 标志、单次重试）三道闸门。Reactive 门挂在 `agent-runtime.ts` 的 `provider_error` 分支（重构 `#run()` 模型调用段为可重试结构），让超窗任务不再直接死。
- **新增 LayeredCompactor（Ch37）**：Tier3（距离 ≤8 全量）/ Tier2（8-19 语义摘要，cap 300 chars，阈 2000）/ Tier1（≥20 元数据桩）分层；距离定义 = 当前 turn 序号 − 该 `tool_result` 所在 turn 序号；Tier2 floor 保护内容型工具（`local_read_file`/`local_search_files`/`local_list_files`）结果；每 pass 语义**尝试**上限 2；`tool_use_id` 配对修复。
- **新增 ContextGovernor**：编排上述流水线，替换 `ContextBuilder.fitModelItems` 的"前删非 protected 原子"路径。用"摘要段替换老段 + recent-tail append-only"产出 cache-stable 投影，解决当前每轮模型上下文前缀变化导致的 prompt cache miss。
- **ConversationCompactor 角色收窄**：只管持久化 durable 摘要 + 提供 summary 回调，不再做单阈值压缩；与 ContextGovernor 互不重复压缩（Governor 投影、Compactor 落盘摘要、GovernanceState 落盘治理元数据）。
- **新增 LoopDetector（Ch43）**：9 条检测路径按序求值先命中者胜——EmptyThink / ToolModeSwitch / SuccessAfterError / ConsecutiveDuplicate（阈值 3）/ ExactDuplicate（阈值 5）/ SameToolError / FamilyNoProgress / SearchEscalation / NoProgress。三级裁决 Continue / Nudge / ForceStop，Nudge 必须在滚动窗口内升级。错误预算非对称（全错误路径 2× 阈值、success-after-error 跳过重复检测）；`[validation error]` 前缀短路（同工具+同参数+连续 3 次校验错误直接 ForceStop）。替换 `agent-runtime.ts` 的单路径 `#recordNoProgress`。
- **ForceStop-with-summary 复用 COMPLETION_REVIEW 管道**：不新建路径。LoopDetector 返回 ForceStop 时注入消息 + 走一次无工具最终模型调用（复用 `calls.length===0` 分支的管道），但跳过 COMPLETION_REVIEW 的"不完整则继续调工具"子分支；模型若在最终调用中仍调工具则忽略 tool_call 只取 text。`maxCompletionReviews` 3→2；完成性复核失败时改优雅降级返回原始 answer，不再硬失败为 `agent_completion_review_failed`（Ch11 graceful degradation）。
- **新增轻量 Planning（Ch10）**：plan-then-execute 预阶段，`DecompositionResult` + `Subtask`（Dependencies/Produces/Consumes/Boundaries）；确定性代码按依赖拓扑排序执行；覆盖率 ≥0.85 且零 critical gaps，MaxIterations=3，不达标走定向 replanning。**本体先做无状态**（崩溃即从用户目标重规划），因副作用安全已由 approval/lease/audit 保障。
- **Ch40 最小子集随治理一起落**（不单独立项）：压缩摘要写完即落盘 + 治理状态持久化（provider 摘要与分类都贵，崩溃重付不可接受）；恢复的 Turn 恒为 unattended（不继承原会话特权）；取消必须清 marker；`InProgress⟺marker` 不变量。Planning 落地时子任务边界打 marker 作为天然 checkpoint。
- **MCP 消费不做**：内置 Agent 维持自研工具集——现有 9 个 `TERMINAL_MODEL_TOOLS`（`terminal_execute` 按可重发性分两档讨论但不拆分工具定义）加新增 `context_recall` 共 10 个工具；桌面端继续作为 MCP server 对外暴露能力，不引入 MCP client 消费。ToolRegistry 统一与 deferred loading（Ch38）暂缓（工具数远低于膨胀阈值）。

## Capabilities

### New Capabilities
- `context-governance`: Agent 模型面上下文投影的治理流水线——Tool-Result 外溢（Preview+Pointer、按可重发性分级、`context_recall` 召回）、分层压缩（Tier3/2/1、Tier2 floor、每 pass 尝试上限）、三道闸门（Proactive/Preflight/Reactive）、cache-stable 投影边界、治理状态持久化（spill/tier/Seen 崩溃不重分类）。

### Modified Capabilities
- `agent-execution`: 卡循环检测从单路径签名比对升级为 9 路径分级裁决（Continue/Nudge/ForceStop、错误预算非对称、`[validation error]` 短路）；ForceStop-with-summary 复用完成性复核管道且复核失败改优雅降级；完成性复核次数上限调整；**正面扩 Restricted Terminal Tools allowlist**——登记 `local_write_file`/`local_edit_file`（修 drift）并新增 `context_recall`（只读上下文召回工具）。
- `structured-agent-progress`: `progress.phase='planning'` 从 UI 相位标签升级为真实任务分解相位——`DecompositionResult`/`Subtask`（Dependencies/Produces/Consumes/Boundaries）、覆盖率评估、定向 replanning、MaxIterations=3。
- `provider-backed-context-summarization`: 摘要持久化增加 Ch40 最小子集——压缩摘要写完即落盘、治理状态（spill/tier/Seen）持久化、恢复的 Turn 恒 unattended、取消清 marker；`ConversationCompaction` 扩展 `gate`/`tier`/`subtaskMarkers` 字段以区分压缩来源与子任务 checkpoint。

## Impact

- **`packages/agent-service/src/context/`**：新增 `context-governor.ts`、`tool-result-spiller.ts`、`layered-compactor.ts`、`three-gate-compactor.ts`；改造 `conversation-compactor.ts`（角色收窄）、`context-budget.ts`（多阈值 0.90/0.95/reactive）、`context-builder.ts`（`fitModelItems` 退化为 governor 入口，废弃前删路径）。
- **`packages/agent-service/src/runtime/`**：新增 `loop-detector.ts`、`task-planner.ts`；改造 `agent-runtime.ts`（`TERMINAL_MODEL_TOOLS` 增 `context_recall`；挂接 governor/loop-detector/planner；Reactive 门挂钩 `provider_error` 并重构 `#run()` 为可重试；ForceStop 复用 COMPLETION_REVIEW 管道；`maxCompletionReviews` 3→2；压缩摘要写完即落盘；`RuntimeOptions` 增 `compactor`/`summarize`/`onCompaction`/`onSubtaskMarker`/`onGovernanceState` 五个注入点——`onSubtaskMarker` 独立于 `onCompaction`，Planning 子任务边界打 marker 与 Governor 摘要持久化是不同关注点）。
- **`packages/domain/src/agent/agent-conversation.ts`**：扩展 `ConversationCompaction`（增 `gate`/`tier`/`subtaskMarkers`）；新增 `ContextGovernanceState`/`ToolResultSpillRecord`/`TierClassification`/`LoopVerdict`/`LoopObservation`/`DecompositionResult`/`Subtask` 类型。
- **`packages/application/src/agent/agent-coordinator.ts`**：装配 governor/planner；注入 `compactor`/`summarize`/`onCompaction`/`onGovernanceState` 到 Runtime；summary 回调复用 `SUMMARY_SYSTEM_PROMPT`，ForceStop 路径选用 `FORCE_STOP_SUMMARY_PROMPT`；审计记录扩展（含 `gate`/`tier`）；治理状态持久化复用 repositories；`#summarizeWithAdapter` 复用于 ForceStop-with-summary。
- **`packages/agent-service/src/index.ts`**：导出新增公共 API。
- **不涉及 Renderer 直接访问 Node/PTY/SQLite/Provider keys**：所有变更在 agent-service / domain / application 层，遵守 Core 拥有 capability/approval/audit 边界。
- **正面扩 Restricted Terminal Tools allowlist**（加 `context_recall` + 登记已有 `local_write_file`/`local_edit_file`），不破坏副作用安全（approval/lease/audit 第一道防线不变），`context_recall` 只读本会话历史不碰 PTY/文件系统/Provider keys。
- **ADR-0018 精神不变**：`#items` 仍是 append-only 完整源，Governor 只改模型面投影，`#emitItem` 仍 emit 完整脱敏项；`context_recall` 从 `#items` 查原始结果不冗余存；摘要仍过 SecretRedactor，`SUMMARY_SYSTEM_PROMPT` 禁令不变。
