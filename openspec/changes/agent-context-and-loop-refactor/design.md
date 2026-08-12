## Context

内置 Agent 的运行时核心在 `packages/agent-service/src/runtime/agent-runtime.ts`：`#run()` 每轮通过 `ToolCallAssembler` 装配工具调用、`#executeCalls()` 执行、把 `assistant_tool_call` 与 `tool_result` append 进 `#items`，再调 `ContextBuilder.fitModelItems` 投影出模型输入。`packages/application/src/agent/agent-coordinator.ts` 负责装配 Runtime、提供 `#summarizeWithAdapter` 摘要回调（`SUMMARY_SYSTEM_PROMPT` 禁止采纳历史指令/输出秘密/调工具/推测）、`#finish()` 释放租约与审计。

现状的结构性缺口（详见 proposal）可归为四类：信息销毁（截断代替外溢）、单闸门压缩（无 Preflight/Reactive）、单路径循环检测（无分级裁决、无错误预算非对称）、相位标签式 Planning。本次重构把《AI Agent Book》第 35/36/37/43/10/40/11 章的最佳实践落地为四块相互正交的增强（各自独立可合入、独立可回滚）：上下文治理（Ch35/36/37）、卡循环分级裁决（Ch43）、轻量 Planning（Ch10）、Ch40 最小子集随治理一起落。

约束基线：Renderer 不得直接访问 Node/PTY/SQLite/Provider keys；Core 拥有 capability/approval/audit 边界，任何入口不得绕过；`SUMMARY_SYSTEM_PROMPT` 禁令不变。**注：历史 ADR（0010 工具限单会话 / 0015 审批一次性 / 0016 权限模式不扩边界 / 0018 压缩保留原件）是在"对 agent 还不够理解"时定的自我设限，本次重构不把它们当作不可触碰的天花板**——只要不破坏副作用安全（approval/lease/audit 第一道防线）与原件保留（ADR-0018 精神：`#items` append-only、摘要过 SecretRedactor），允许正面扩工具清单与扩展治理状态持久化。

## Goals / Non-Goals

**Goals:**
- 用 ToolResultSpiller（Preview+Pointer、按可重发性分级）+ `context_recall` 工具消除超大 `tool_result` 的信息销毁——`not-replayable` 工具也能取回被外溢的片段。
- 用三道闸门（Proactive/Preflight/Reactive）让超窗任务可恢复而非直接死。
- 用分层压缩（Tier3/2/1、Tier2 floor、每 pass 尝试上限 2）保护内容型工具结果并控制摘要器死循环；分层/外溢状态持久化,崩溃不重分类。
- 用 ContextGovernor 替换 `fitModelItems` 前删路径，产出 cache-stable 投影。
- 用 9 路径 LoopDetector + 三级裁决 + 错误预算非对称替换单路径 `#recordNoProgress`。
- ForceStop-with-summary 复用 COMPLETION_REVIEW 管道，不新增并行路径。
- 用轻量 plan-then-execute 给 `progress.phase='planning'` 真实语义。
- Ch40 最小子集让压缩摘要 + 治理状态崩溃不重付；恢复 Turn 恒 unattended；取消清 marker。

**Non-Goals:**
- 不引入 MCP client 消费（内置 Agent 维持自研工具集，桌面端仍是 MCP server）。
- 不做 ToolRegistry 统一与 deferred loading（Ch38，工具数远低于膨胀阈值）。
- 不做 ToT/Debate/Research-Synthesis（附录B：80% 需求 ReAct+Planning，15% Reflection，5% ToT/Debate）。
- 不做完整 Ch40 恢复栈（仅摘要 + 治理状态持久化 + 子任务边界 marker + unattended 分类；不实现完整 checkpoint/resume 引擎）。
- 不改 `#items` append-only 语义与 ADR-0018 原件保留精神（投影/召回只读源，不改源）。

## Decisions

### Decision 1: 用"摘要段替换 + append 尾"代替"前删原子"以稳定 prompt cache 前缀

`fitModelItems`（`context-builder.ts:260-290`）在超预算时从前向后删除最老的 非 protected 原子直到放下。`#items` 本身 append-only（fit 操作的是 clone，不改源），但**投影前缀每轮都在变**——cache 每轮 miss。

**决策**：ContextGovernor 投影时把老段替换为稳定 summary-segment，recent-tail append-only。前缀稳定点只随压缩事件变，不随每轮变。

**Alternatives**：
- 保留前删但做增量缓存（只重算变化段）——复杂且前缀仍变，不如替换式稳定。
- 用 prompt cache breakpoints（部分 provider 支持）——依赖 provider 能力，不通用，作为后续优化而非本次主路径。

### Decision 2: 加 `context_recall` 工具 + 持久化分层状态（方案 b，解除 ADR 自我设限）

Ch36 的 Pointer 语义是"让模型知道这条被外溢了、可重取"。原方案选 (d) 不加工具、靠"重发更窄查询"取回,但这对 **`not-replayable` 工具失效**——有副作用的 `terminal_execute`、`terminal_wait`、`terminal_interrupt`、`local_write_file`、`local_edit_file` 无法重发,纯 Pointer 下模型只能"请求用户确认",信息仍不可达。加 `context_recall` 工具后,模型可凭指针主动召回被外溢原始结果的**指定片段**,这是纯 Pointer 方案在 `not-replayable` 场景的核心增量。

本产品 `TERMINAL_MODEL_TOOLS` 共 9 个工具（`agent-runtime.ts:31-134`），按可重发性全覆盖：

| 工具 | 可重发性 | 外溢策略 | 召回角色 |
|---|---|---|---|
| `local_read_file` | ✅ 带 startLine/endLine 重读窄区间 | 激进，self-bounded 豁免（Tier2 floor） | 备选（优先重发拿最新） |
| `local_search_files` | ✅ 重发更窄 query | 激进 | 备选 |
| `local_list_files` | ✅ 重列 | 激进 | 备选 |
| `terminal_observe` | ✅ 再 observe | 激进 | 备选 |
| `terminal_execute`（只读） | ✅ 重发更窄诊断命令 | 中等 | 备选 |
| `terminal_execute`（有副作用） | ⚠️ 不可重放 | 保守 preview，标 `not-replayable` | **主途径**（唯一取回） |
| `terminal_wait` | ⚠️ 不可重放 | 保守 preview，标 `not-replayable` | **主途径** |
| `terminal_interrupt` | ⚠️ 不可重放 | 保守 preview，标 `not-replayable` | **主途径** |
| `local_write_file` | ⚠️ 不可重放 | 保守 preview，标 `not-replayable` | **主途径** |
| `local_edit_file` | ⚠️ 不可重放 | 保守 preview，标 `not-replayable` | **主途径** |

**兜底条款**：上表未列出的任何未来工具默认 `not-replayable` + 保守 preview，直至显式分级。

**`context_recall` 工具设计**：
- 签名：`{ toolCallId: string（必填，被外溢的原始 tool_result 的 toolCallId）, startLine?: integer, endLine?: integer, maxBytes?: integer }`。
- 实现：从 append-only `#items` 历史存储按 `toolCallId` 查原始 `tool_result`（复用 ADR-0018 原件保留，不冗余存原始内容），按 `startLine/endLine/maxBytes` 切片返回。切片仍受 `maxBytes` 上限约束（ContextGovernor 初始化时配置默认上限 = 16KB，MUST NOT 超过单条外溢预算——过大击穿 Seen set 防全量回灌、过小使召回失效），防止把超大结果又全量塞回。
- 召回片段仍是 `tool_result`（新 `toolCallId`），进入 `#items` 与模型面，受 Seen set 防全量回灌保护。
- system prompt 引导：`re-issuable` 工具优先重发更窄查询（拿最新结果），召回作为备选；`not-replayable` 工具用 `context_recall` 取回需要的片段。

**Seen set 语义调整**：原 (d) 方案 Seen set "阻止模型重读已外溢的完整结果"。加召回工具后，Seen set 改为"防全量回灌"——Governor 投影时仍用 preview+指针替换超大结果（不会把全量塞回），但模型通过 `context_recall` 显式召回受限片段是允许的。Seen set 不阻止显式召回，只阻止投影路径的全量回灌。

**持久化分层状态**（用户明确要求，Ch40 精神延伸——分类/外溢状态也是"贵"的，崩溃重付不可接受）：
- 新增持久化记录 `ContextGovernanceState`（conversationId + `spillRecords: ToolResultSpillRecord[]`（每个含 `toolCallId`/可重发性/preview 头尾各 ≤512 字节/原始 `toolCallId` 引用）+ `tierClassifications: { toolCallId, tier, classifiedAtTurn }[]` + `seenToolCallIds: string[]` + `schemaVersion: number` 初始 1）。
- 原始结果内容**不**冗余持久化——仍在 append-only `#items`（ADR-0018 原件保留），`context_recall` 从 `#items` 查；`ContextGovernanceState` 只持久化元数据 + 小 preview，存储成本低。
- 持久化语义：按 `conversationId` 整体 upsert（整体替换，非增量 append）；`onGovernanceState` 回调防抖约 2s（类比 Compaction），MUST NOT 每次 spill/tier 变化都立即写盘导致高频 IO。
- 版本化向前兼容：`schemaVersion` 初始 1，类比 `ConversationCompaction` 的向前兼容读取——旧数据缺字段以默认值补齐，MUST NOT 崩溃或丢弃已有状态。需同步扩展 `packages/protocol/src/schemas/domain-schemas.ts` 的 `conversationCompactionSchema`（`z.strictObject`）把 `gate`/`tier`/`subtaskMarkers`/`schemaVersion` 加为 optional 带默认值，并新增 `contextGovernanceStateSchema`，避免 strict 模式 strip 新字段或 parse 失败；`packages/infrastructure/src/store/repositories.ts` 的 `CoreRepositories` 新增 `saveContextGovernanceState`/`getContextGovernanceState` 方法 + 新建 `context_governance_states` 表/keyspace。
- Governor 每次产生新的 spill/tier 分类时通过 `onGovernanceState` 回调交回 coordinator 持久化。
- 崩溃恢复时 Governor 从持久化 `ContextGovernanceState` 重建 spill/tier/Seen 状态，**不重新分类、不重新外溢**——分类可能调过摘要器（贵），重付不可接受。
- 持久化失败降级：若 `onGovernanceState` 持久化抛错（如磁盘满），Governor MUST 视为 GovernanceState 不可用并 fail closed 或在下轮重建（容忍重分类成本），MUST NOT 让内存状态与持久化状态静默不一致。

**`context_recall` 执行路径（短路，非 Gateway）**：`#items` 是 Runtime 私有，`#executeCalls` 现状委托给外部 `RuntimeToolGateway`（后者无法访问 `#items`）。`context_recall` MUST 在 `#executeCalls` 内部短路——识别 `name === 'context_recall'` 的调用时直接从 Runtime `#items` 按 `toolCallId` 查询切片返回，MUST NOT 经 `RuntimeToolGateway`。召回片段经既有 `#emitItem`/`#redactItem` 脱敏路径发射与持久化（ADR-0018 原件保留精神）；崩溃恢复后 `#items` 从持久化（已脱敏）项重建，`context_recall` 返回的也是已脱敏片段，行为与崩溃前一致。

**解除 ADR 自我设限**（用户："不要被历史 ADR 约束了，之前是我也不懂 agent"）：
- 加 `context_recall` 为第 10 个工具，**正面扩** Restricted Terminal Tools allowlist（改 `agent-execution` spec）。`context_recall` 是只读上下文管理工具（只查本会话历史，不改状态、不碰 PTY/文件系统），不扩大权限模式的破坏面——任何权限模式下模型都能查自己会话的历史，副作用安全仍由 approval/lease/audit 兜底。
- ADR-0010 精神（工具限单会话）不变——`context_recall` 只召回**本会话**历史。
- ADR-0018 精神（原件保留）不变——`#items` 仍是 append-only 完整源，召回从 `#items` 查，分层状态是额外投影元数据。
- **顺手修预存 spec/code drift**：现有 `openspec/specs/agent-execution/spec.md` 的 "Restricted Terminal Tools" requirement 只授权 7 个工具，未提 `local_write_file`/`local_edit_file`（代码里已存在）。本 Change 一并把这两个工具登记进 allowlist，spec 与代码对齐。

**决策**：加 `context_recall`（第 10 个工具）+ 持久化分层状态 + 正面扩 allowlist + 修 drift。preview = 头尾保留 + `[spilled:toolCallId, re-issuable|not-replayable]` 指针。`re-issuable` 工具 Pointer 优先（重发拿最新），`not-replayable` 工具 `context_recall` 是主取回途径。

**Alternatives**：
- (d) 不加工具，靠重发更窄查询取回——`not-replayable` 场景失效，信息仍不可达，弱化 Ch36 核心价值。原选 (d) 的唯一理由是"碰 ADR-0010/0016"，用户已明确解除该自我设限。
- (c) 退化为聪明截断——放弃重取语义，弱化 Ch36 核心价值。

### Decision 3: Governor 管投影，ConversationCompactor 管持久化

```
#items (append-only, #emitItem 脱敏, ADR-0018 精神不变)
   │
   ▼
ContextGovernor.project(items, budget)        ← runtime 侧, 每轮
 ├─ ToolResultSpiller (Ch36)
 ├─ LayeredCompactor (Ch37)
 └─ ThreeGate (Ch35)
   │  产出新的持久化摘要时
   ▼
ConversationCompactor.persist(Compaction)     ← coordinator 侧
 ├─ ConversationCompaction 记录 (原件保留)
 ├─ provider 摘要回调 (SUMMARY_SYSTEM_PROMPT, 过 SecretRedactor)
 └─ 确定性兜底
   │  产出新的 spill/tier 分类时
   ▼
ContextGovernanceState 持久化                  ← coordinator 侧, onGovernanceState 回调
```

**决策**：Governor 投影、Compactor 落盘摘要、GovernanceState 落盘治理元数据，三者互不重复。Compactor 不再做单阈值压缩，角色收窄为"durable 摘要持久化 + summary 回调"。

**接线方式（解决现状接线缺失）**：现状 `ConversationCompactor` 仅在 `agent-coordinator.ts:308` 于 runtime 启动前被调用一次，Runtime 本身没有 compactor/summarize/onCompaction 引用，`#summarizeWithAdapter` 是 coordinator 私有方法，`saveConversationCompaction` 也走 coordinator 的 `#repositories`。为让 Governor 在每轮投影中能委托 Compactor 持久化，接线如下：

- `RuntimeOptions` 新增五个注入点：`compactor`（ConversationCompactor 实例）、`summarize`（摘要回调，复用 coordinator 的 `#summarizeWithAdapter`）、`onCompaction`（`ConversationCompaction` 回调，交回 coordinator 持久化）、`onSubtaskMarker`（子任务边界 marker 回调，交回 coordinator 打/清 `subtaskMarkers`）、`onGovernanceState`（`ContextGovernanceState` 回调，交回 coordinator 持久化）。
- **`onSubtaskMarker` 独立于 `onCompaction` 的理由**：Planning 子任务边界打 marker 是"任务进展 checkpoint"语义，Governor 摘要持久化是"上下文治理贵状态 checkpoint"语义，两者关注点不同。复用 `onCompaction` 一个回调承载两种语义会让"何时落盘 Compaction 记录"的触发条件混乱（marker 变化不应触发摘要重写、摘要变化不应触发 marker 重打）。分离为两个回调后各自语义清晰：`onCompaction` 只在 Governor 产出新摘要时触发，`onSubtaskMarker` 只在 Planner 进新子任务边界/取消时触发。两者最终都落到 `ConversationCompaction` 记录的不同字段（`summary`/`gate`/`tier` vs `subtaskMarkers`）。
- Coordinator 在装配 Runtime 时把五者一起注入；Runtime 再传给 Governor（`compactor`/`summarize`/`onCompaction`/`onGovernanceState`）与 Planner（`onSubtaskMarker`）。
- Governor 产出需要持久化的新摘要时，通过 `onCompaction` 把 `ConversationCompaction`（含 `gate`/`tier` 字段，`subtaskMarkers` 由 Planner 经 `onSubtaskMarker` 单独维护，二者写同一记录的不同字段）交回 coordinator；coordinator 复用现有 `saveConversationCompaction` 路径落盘。
- Governor 产出新的 spill/tier 分类时，通过 `onGovernanceState` 把 `ContextGovernanceState` 交回 coordinator 持久化（防抖约 2s，整体 upsert）。
- Governor 的增量状态基于 `toolCallId`/`sequence` 而非 item index，避免 `#items` append 导致的 index 漂移。
- **`context_recall` 执行路径**：`#executeCalls` 识别 `name === 'context_recall'` 的调用时直接从 Runtime `#items` 按 `toolCallId` 查询切片返回，MUST NOT 经 `RuntimeToolGateway`（Gateway 无法访问 `#items`）；召回片段经 `#emitItem`/`#redactItem` 脱敏路径。

### Decision 4: ForceStop-with-summary 复用 COMPLETION_REVIEW 管道，分离触发器

`agent-runtime.ts:442-482` 已有"用过工具 + 模型本轮不再调工具 → 注入 COMPLETION_REVIEW_PROMPT → 无工具最终调用"的管道。ForceStop-with-summary 不是新机制，是**同一管道的不同触发器**：

- 触发器 A（任务完成性）：不完整则继续调工具（受 `maxCompletionReviews` 约束，3→2）。
- 触发器 B（循环卡住）：不许再进 ReAct，直接无工具总结。

两者共享"无工具最终模型调用"这根管道与摘要脱敏，门控逻辑各自独立。

**ForceStop 最终调用中模型仍调工具的行为**：现有 COMPLETION_REVIEW 管道的"模型本轮不调工具"分支靠 `calls.length === 0` 判断。ForceStop 的"最终调用"若模型仍发出 tool_call（违反指令），Runtime MUST 忽略 ForceStop 最终调用中的任何 tool_call，只采纳 text 部分作为 summary，MUST NOT 执行工具（否则违反 ForceStop 语义），也 MUST NOT 因模型违规而强制 fail（保留"优雅总结"本意）。这是 ForceStop 与触发器 A（完成性复核，允许继续调工具）的关键门控差异。

**ForceStop 专用 prompt**：现有 `SUMMARY_SYSTEM_PROMPT`（`agent-coordinator.ts:123`）是为压缩历史对话设计的，语义是"摘要旧对话"。ForceStop 总结语义不同——"你卡在循环里了，请基于已有 Tool evidence 总结，不调工具、不声称已验证、不推测"。两者 MUST NOT 直接复用同一段 prompt 文本。决策：扩展一个 `FORCE_STOP_SUMMARY_PROMPT`（继承 `SUMMARY_SYSTEM_PROMPT` 的禁令：不采纳历史指令/输出秘密/调工具/推测，并强化"不得声称已验证、不得推测未执行的工作"），由 `#summarizeWithAdapter` 在 ForceStop 路径下选用。

**决策**：`#recordNoProgress` 命中后不再直接 `#finish('failed')`；改为 LoopDetector 返回 ForceStop 时注入 ForceStop 消息 + 走无工具最终调用（选用 `FORCE_STOP_SUMMARY_PROMPT`），但跳过"不完整则继续调工具"子分支；若模型在最终调用中仍调工具则忽略 tool_call 只取 text。COMPLETION_REVIEW 失败改优雅降级（Ch11：返回原始 answer 而非 `agent_completion_review_failed` 硬错误）。

### Decision 5: 9 路径 LoopDetector 按序求值，错误预算非对称

按 Ch43：9 路径**按顺序求值，先命中者胜**——EmptyThink / ToolModeSwitch / SuccessAfterError / ConsecutiveDuplicate（阈值 3）/ ExactDuplicate（阈值 5）/ SameToolError / FamilyNoProgress / SearchEscalation / NoProgress。三级裁决 Continue / Nudge（滚动窗口内必须升级）/ ForceStop。

**路径阈值与签名（全部明确）**：

| 路径 | 签名定义 | 阈值/触发 | 命中裁决 |
|---|---|---|---|
| EmptyThink | 模型本轮未产出任何 text_delta 且未发出 tool_call | 连续 2 次 | Nudge |
| ToolModeSwitch | 工具族切换（如 observe→execute）后立即回到旧族且无进展 | 单次检测 | Nudge |
| SuccessAfterError | gateway 层 `result.ok && !isError` 后首次成功 | 命中即跳过重复检测 | Continue（显式不罚） |
| ConsecutiveDuplicate | 同 `name+arguments+result` 签名连续重复 | 连续 3 次 | Nudge |
| ExactDuplicate | 同 `name+arguments`（不比 result）总数达阈值 | 累计 5 次 | ForceStop |
| SameToolError | 同一工具连续返回 `isError` | 连续阈值 = 正常路径阈值（3） | Nudge→ForceStop |
| FamilyNoProgress | 同工具族（terminal/local）无进展 | 连续 4 次 | Nudge |
| SearchEscalation | search 类工具 query 逐次放大无进展 | 连续 3 次 | Nudge |
| NoProgress | 通用 `#recordNoProgress` 签名无进展 | 连续 3 次 | Nudge→ForceStop |

**Nudge→ForceStop 滚动窗口**：Nudge 后窗口 = 2 次后续调用。若 2 次内未升级（未切换工具族/未改参数/未产生新进展签名），升 ForceStop。ExactDuplicate（阈值 5）与 ConsecutiveDuplicate（阈值 3）的求值顺序保证：连续 3 次完全相同先命中 ConsecutiveDuplicate→Nudge，若模型不升级，第 5 次前 Nudge 窗口已耗尽升 ForceStop；ExactDuplicate 作为"参数相同但 result 不同、累计 5 次"的兜底，覆盖 ConsecutiveDuplicate（含 result）抓不到的情况。

**初始实施范围（解决 Open Question OQ-1）**：spec 把 9 条路径中 **4 条核心 + 错误预算非对称 + `[validation error]` 短路**定为 MUST（ConsecutiveDuplicate / ExactDuplicate / SameToolError / NoProgress + 错误预算非对称 + `[validation error]` 短路），其余 5 条形状判定路径（EmptyThink / ToolModeSwitch / SuccessAfterError / FamilyNoProgress / SearchEscalation）定为 SHOULD（增量补，路径从事故长出）。tasks 阶段 3 实现 MUST 部分。

错误预算非对称：
- 全错误路径 2× 阈值（"重试失败操作是正当工作"、"重复的失败常常是进展"）：正常路径阈值 3，全错误路径阈值 = 6，**计数达 6 时触发**（即第 6 次连续错误调用）。
- success-after-error 跳过重复检测（"模型刚挣脱出来那一刻惩罚它是错的"）：success 定义 = gateway 层 `result.ok === true && result.isError !== true`，不要求结果有信息量。
- `[validation error]` 前缀短路：同工具+同参数+连续 3 次校验错误直接 ForceStop，远早于通用全错误预算的第 6 次。
- truthful-tools-first：探测器只管"重复"，不管"第一次"做错——副作用安全由 approval/lease/audit 第一道防线保障。

**新增风险（replanning 安全性）**：Planning 无状态 + 副作用工具的 replanning。若崩溃发生在一个有副作用的子任务之后、下一个子任务之前，重规划可能重复执行已完成的副作用子任务。缓解：marker 落在 `ConversationCompaction.subtaskMarkers`（持久化），重规划前 Runtime MUST 先读 marker 跳过已完成的副作用子任务；LLM 规划调用也 MUST 在 prompt 里注入"已完成子任务清单"（来自 marker）。副作用安全仍由 approval/lease/audit 第一道防线兜底（重放的副作用命令仍需审批）。

**Alternatives**：
- 全部路径并行评估取最严重——Ch43 明确按序先命中者胜，因为每条编码的是"无进展"的不同定义，并行会掩盖最具体的信号。
- 收紧阈值到 2/3——Ch43 明确从 2/3 提到 3/5 是刻意的，正当迭代也会产生重复形状。

### Decision 6: 轻量 Planning 先无状态，Ch40 最小子集随治理一起落

Ch40 说"压缩摘要是最该 checkpoint 的贵东西"。本次锁了"全套上下文治理"，A2/A3 会产生 provider 摘要（贵），分层/外溢分类也是贵操作。不持久化 = 崩溃重付全部摘要 + 重新分类。

**决策**：
- Planning 本体先无状态（崩溃即从用户目标重规划）——副作用安全已由 approval/lease/audit 保障，重规划只损失 LLM 规划调用（相对便宜）。
- 压缩摘要写完即落盘（`conversation-compactor.ts` 已持久化 `ConversationCompaction`，补"写完即落盘 + 防抖 2s"）。
- **治理状态持久化**（Decision 2）：spill/tier/Seen 状态落盘为 `ContextGovernanceState`，崩溃恢复不重新分类/外溢。
- **marker 载体**：子任务 marker 落在 `ConversationCompaction.subtaskMarkers: {subtaskId, inProgress: boolean}[]`（持久化字段，非内存）。Planning 虽无状态，但进入新子任务时 Runtime MUST 调 Planner 经 `onSubtaskMarker` 回调打 marker（coordinator 侧串行化 read-modify-write 合并字段，避免与 `onCompaction` 的 `summary`/`gate`/`tier` 写入互相 clobber）；取消 MUST 调 `clearInProgressMarker()`。`InProgress⟺marker` 不变量：有 marker 则必有 InProgress 子任务，反之亦然，在每条持久化路径上维护。
- Planning 落地时子任务边界打 marker 作为天然 checkpoint。
- 恢复的 Turn 恒 unattended（不继承原会话特权）。
- 取消必须清 marker。
- **replanning 安全**：重规划前 Runtime MUST 先读 `subtaskMarkers` 跳过已完成的副作用子任务，并在 LLM 规划 prompt 里注入"已完成子任务清单"；副作用命令重放仍需 approval/lease/audit 审批兜底。

Planning 的 `DecompositionResult`/`Subtask`（Dependencies/Produces/Consumes/Boundaries）按 Ch10；确定性代码按依赖拓扑排序执行；覆盖率 ≥0.85 且零 critical gaps；MaxIterations=3；不达标走定向 replanning（非从头重规划）。简单任务门控跳过（附录B Occam 剃刀）。

**Alternatives**：
- Planning + 完整 Ch40 resume 引擎——Ch40 对本产品的缺口比通用 Agent 窄（副作用安全已覆盖），完整 resume 是过度工程。
- Planning 完全无状态且不落盘摘要/治理状态——摘要与分类都贵，崩溃重付不可接受。

## Risks / Trade-offs

- **[Governor 每轮重投影性能]** → 增量维护 spill/tier 状态（不每轮全量重算）；`#items` append-only 天然支持增量。增量状态数据结构：`Map<toolCallId, SpillState>` + dirty flag，基于 `toolCallId`/`sequence` 而非 item index（避免 append 漂移）。持久化后崩溃恢复直接加载，不重算。
- **[Prompt cache 命中依赖 provider 支持 prefix caching]** → 在 `ModelAdapter` 层声明能力；不支持时退化但仍正确，只是无 cache 收益。
- **[Planning 多一次 LLM 调用增加延迟]** → 门控 + MaxIterations=3 控上界；简单任务直接跳过。
- **[ForceStop-with-summary 无工具最终调用可能产出无证据总结]** → 专用 `FORCE_STOP_SUMMARY_PROMPT`（继承 `SUMMARY_SYSTEM_PROMPT` 禁令 + 强化"不得声称已验证、不得推测未执行的工作"）；模型在最终调用中仍调工具时忽略 tool_call 只取 text。
- **[spill preview 质量是唯一关键变量]** → 头尾保留 + 指针标注可重发性 + `context_recall` 兜底取回；保守 preview 给不可重放的有副作用命令，但模型可召回片段。
- **[LoopDetector 9 路径维护成本]** → 路径从事故长出而非第一性原理；spec 区分 MUST（4 条核心 + 错误预算非对称 + `[validation error]` 短路）与 SHOULD（5 条形状判定增量补）。
- **[Ch40 最小子集的 `InProgress⟺marker` 不变量需每条持久化路径维护]** → 集中在 ConversationCompactor.persist 与 Runtime 取消路径；marker 落在 `ConversationCompaction.subtaskMarkers`（持久化字段）；测试覆盖孤儿标记场景。
- **[Reactive 压缩时当前 turn 已装配但未执行的 tool_call batch 配对]** → Reactive 闸门触发在模型调用失败后，此时本轮尚无 assistant_tool_call 落 items；若已有半批，压缩前 MUST 先完成配对修复或丢弃未执行 batch，再压缩。
- **[Planning 无状态 + 副作用工具的 replanning 安全性]** → 重规划前 Runtime MUST 先读 `subtaskMarkers` 跳过已完成副作用子任务并在 prompt 注入"已完成清单"；副作用命令重放仍经 approval/lease/audit 审批兜底。
- **[`context_recall` 被滥用全量回灌]** → Seen set 改"防全量回灌"语义 + `maxBytes` 切片上限 + system prompt 引导优先重发；召回片段受预算约束，不会把超大结果又全量塞回。**分片滥用兜底（K2）**：模型可对同一 `toolCallId` 连续召回相邻切片（startLine/endLine 不同 → result 签名不同 → LoopDetector 的 ConsecutiveDuplicate 含 result 比对不命中），累积等价于全量回灌。缓解：对同一 `toolCallId` 的 `context_recall` 调用施加 per-`toolCallId` 召回次数/总字节上限（超出则该 `toolCallId` 进入 Seen set 不再允许召回，或返回"已达召回上限"占位），MUST NOT 仅靠 LoopDetector 的 result 签名判定。
- **[`onSubtaskMarker` 与 `onCompaction` 写同一 `ConversationCompaction` 记录的竞态（K3）**：分离两个回调后，同 turn 内 Planner 打 marker 与 Governor 产新摘要可能并发写同一记录的不同字段（`subtaskMarkers` vs `summary`/`gate`/`tier`）。缓解：coordinator 侧持久化 MUST 对同一 `conversationId` 的 `ConversationCompaction` 记录做串行化 read-modify-write（合并字段而非整体覆盖），MUST NOT 让两个回调的写入互相 clobber。
- **[治理状态持久化的存储成本]** → `ContextGovernanceState` 只存元数据 + 小 preview（头尾各 ≤512 字节），原始结果仍在 `#items` 不冗余；存储成本可控。
- **[治理状态持久化失败降级（K4）**：磁盘满或 IO 异常时 `onGovernanceState` 抛错。缓解：Governor 视为 GovernanceState 不可用并 fail closed 或下轮重建（容忍重分类成本），MUST NOT 让内存状态与持久化状态静默不一致。
- **[解除 ADR 自我设限后的破坏面扩大审查]** → `context_recall` 只读本会话历史、不碰 PTY/文件系统/Provider keys，破坏面不扩大；登记 `local_write_file`/`local_edit_file` 是修 drift（代码本就在），不新增破坏面。

## Migration Plan

分四阶段，每阶段独立可合入、独立可验证：

1. **治理底座（Decision 1/2/3）**：ToolResultSpiller（按可重发性分级）+ `context_recall` 工具（含 allowlist 扩 + drift 修）+ ContextGovernor（替换 fitModelItems，cache-stable 投影）+ Compactor 角色收窄 + 治理状态持久化骨架。先解决信息销毁 + cache 每轮 miss 两个最痛点。回滚 = 恢复 `fitModelItems` 前删路径 + 移除 `context_recall`。
2. **三道闸门 + 分层（Ch35/37）**：ThreeGate（Reactive 门挂 `provider_error`，**重构 `#run()` 模型调用段为可重试结构**：never-reset 标志 + retry-once 循环，非简单挂钩）+ Layered（Tier2 floor，**距离定义 = 当前 turn 序号 − 该 tool_result 所在 turn 序号**）。同时落 Ch40 摘要持久化最小子集。回滚 = 退回单阈值压缩（功能退化但不破坏），**前提：阶段 4 未合入或一并回滚**（阶段 4 的 Planning marker 依赖阶段 2 的 Ch40 摘要持久化基础设施）。
3. **循环治理（Decision 4/5）**：LoopDetector 9 路径（MUST 4 条核心 + 错误预算非对称 + `[validation error]` 短路，SHOULD 5 条增量补）+ ForceStop 复用 COMPLETION_REVIEW 管道 + `maxCompletionReviews` 3→2 + review 失败降级。回滚 = 恢复单路径 `#recordNoProgress`。
4. **轻量 Planning（Decision 6）**：Planner + 子任务分解 + 覆盖率护栏 + MaxIterations=3 + unattended 分类 + 取消清 marker。回滚 = Planning 降级为相位标签。

## Open Questions

- ~~LoopDetector 初始实现是否包含全部 9 路径~~ **已定标**：spec 区分 MUST（4 条核心 ConsecutiveDuplicate/ExactDuplicate/SameToolError/NoProgress + 错误预算非对称 + `[validation error]` 短路）与 SHOULD（其余 5 条形状判定 EmptyThink/ToolModeSwitch/SuccessAfterError/FamilyNoProgress/SearchEscalation），tasks 阶段 3 实现 MUST 部分，SHOULD 增量补。理由：路径从事故长出，初始全做风险高；但 spec 不能写 9 条 MUST 而实施只做 4 条导致矛盾。
- ~~Planning 门控信号具体取哪些~~ **已定标**：spec 给"至少之一"兜底（多步动词 / 显式 `/plan` / ContextBuilder 估算超过 N 步），实施弹性足够。tasks 4.3 把 N 定为 5。
- ~~预存 spec/code drift（`local_write_file`/`local_edit_file` 未登记）~~ **已定标**：解除 ADR 自我设限后，本 Change 一并登记修 drift，spec 与代码对齐。
