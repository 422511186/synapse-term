## ADDED Requirements

### Requirement: Tool-Result Overflow by Re-issuability Grading
当单个 `tool_result` 或单轮聚合 `tool_result` 超过外溢预算时，ContextGovernor MUST 用"头尾 Preview + 指针"替换全文注入，MUST NOT 用截断丢弃信息。指针 MUST 标注 `toolCallId` 与可重发性（`re-issuable` 或 `not-replayable`）。外溢策略 MUST 按工具可重发性分级：可重发工具（`local_read_file`、`local_search_files`、`local_list_files`、`terminal_observe`、只读 `terminal_execute`）采用激进外溢；不可重放工具（有副作用的 `terminal_execute`、`terminal_wait`、`terminal_interrupt`、`local_write_file`、`local_edit_file`）采用保守 preview 并标 `not-replayable`。上表未列出的任何未来工具 MUST 默认 `not-replayable` + 保守 preview，直至显式分级。可重发工具中的 self-bounded 工具（`local_read_file`）MUST 获得外溢豁免，其结果在分层压缩中享有 Tier2 floor 保护。系统 MUST 维护 Seen set（以 `toolCallId` 为键），其语义为"防全量回灌"——Governor 投影时 MUST 用 preview+指针替换超大结果、MUST NOT 把已被外溢的完整结果再次全量注入模型面；但 Seen set MUST NOT 阻止模型通过 `context_recall` 工具显式召回受限片段（见 Context Recall Tool requirement）。Seen set MUST 随 `ContextGovernanceState` 持久化（`seenToolCallIds` 字段），崩溃恢复时从持久化状态还原，MUST NOT 从 `#items` 重新构建（与 spill/tier 分类同属"贵状态崩溃重付不可接受"）。

#### Scenario: Oversized read-file result is spilled with a re-issuable pointer
- **WHEN** `local_read_file` 返回的内容超过单条外溢预算
- **THEN** Governor 用头尾片段加 `[spilled:<toolCallId>, re-issuable]` 指针替换全文，模型可凭更窄的 startLine/endLine 重读取回完整内容，原始 `tool_result` 仍在 append-only `#items` 中保留

#### Scenario: Side-effecting command result is conservately previewed
- **WHEN** 有副作用的 `terminal_execute`、`terminal_wait`、`terminal_interrupt`、`local_write_file` 或 `local_edit_file` 结果超过外溢预算
- **THEN** Governor 用保守头尾 preview 替换全文并标注 `[spilled:<toolCallId>, not-replayable]`，MUST NOT 声称可重放，模型若需更多片段可通过 `context_recall` 工具召回指定片段

#### Scenario: Unlisted future tool defaults to not-replayable
- **WHEN** 一个尚未分级的工具的结果超过外溢预算
- **THEN** Governor MUST 按 `not-replayable` 保守 preview 处理，直至该工具被显式分级

#### Scenario: Projection prevents full re-injection while allowing explicit recall
- **WHEN** 模型面投影过程中遇到已被外溢的 `toolCallId`
- **THEN** Governor MUST 用 preview+指针替换、MUST NOT 全量回灌完整结果；若模型随后通过 `context_recall` 显式请求该 `toolCallId` 的片段，Seen set MUST NOT 阻止该显式召回

#### Scenario: Seen set restored from persisted state after runtime recovery
- **WHEN** runtime 崩溃恢复后模型尝试读取已被外溢的 `toolCallId`
- **THEN** Governor 从持久化 `ContextGovernanceState` 还原 Seen set，仍阻止投影路径的全量回灌，但允许 `context_recall` 的显式受限召回，MUST NOT 从 `#items` 重新构建 Seen set

### Requirement: Layered Context Compaction
ContextGovernor MUST 对历史 `tool_result` 按对话距离做分层压缩。**距离定义 = 当前 turn 序号 − 该 `tool_result` 所在 turn 序号**（基于 `turnId`/`sequence`，非 item 数组索引）。分层阈值：Tier3（距离 ≤8，保留全文）、Tier2（距离 8-19，语义摘要，单条 cap 300 字符，触发阈值 2000）、Tier1（距离 ≥20，仅保留元数据桩）。分层 MUST 在首次接触时分类（first-touch classification）并按 `tool_use_id` 与对应 `tool_result` 配对。内容型工具（`local_read_file`、`local_search_files`、`local_list_files`）的结果 MUST 享有 Tier2 floor——即使距离超过 8-19 区间也至少保留 Tier2 语义摘要而非降为 Tier1 元数据桩。每个压缩 pass 的语义**尝试**上限为 2（计数尝试而非成功），超出后 MUST 退化为确定性截断，MUST NOT 让摘要器无限重试。配对修复 MUST 在压缩边界处维持 `tool_use` 与 `tool_result` 的成对完整性。

#### Scenario: Recent tool result stays full-text
- **WHEN** 某条 `tool_result` 与当前轮的距离 ≤8
- **THEN** Governor 保留其全文，不进行语义摘要或元数据降级

#### Scenario: Mid-distance content tool result gets semantic summary with floor
- **WHEN** 内容型工具结果距离进入 8-19 区间
- **THEN** Governor 产出 cap 300 字符的语义摘要；即使距离超过 19 也 MUST 保留至少 Tier2 摘要而非降为 Tier1 桩

#### Scenario: Distant non-content tool result becomes metadata stub
- **WHEN** 非 content 型工具结果距离 ≥20
- **THEN** Governor 仅保留带工具身份与错误状态的元数据桩，原始 Model Item 仍可从历史存储查询

#### Scenario: Semantic summary attempts are bounded
- **WHEN** 某个压缩 pass 中语义摘要尝试达到 2 次仍未成功
- **THEN** Governor 退化为确定性截断，MUST NOT 继续重试摘要器

### Requirement: Three-Gate Context Compression
ContextGovernor MUST 用三道闸门控制压缩：Proactive（估算 token 达到预算 0.90 时触发）、Preflight（发送给 Provider 前达 0.95 时触发）、Reactive（命中 `context_length_exceeded` 后触发，never-reset 标志，单次重试）。Reactive 闸门 MUST 挂在 Runtime 的 `provider_error` 处理分支上，让超窗任务可恢复而非直接失败。压缩 MUST 保留三段结构（opening / summary / recent，floor 至少 3 对完整 tool_use/tool_result），并在边界处修复被拆开的 tool_use/tool_result 对。截断边界 MUST 选择 cache-aware 的稳定点，使 prompt cache 前缀尽量不变。Reactive 闸门 MUST 仅重试一次，重试后仍超窗则 fail closed。

#### Scenario: Proactive gate triggers at estimation threshold
- **WHEN** 估算 token 达到预算 0.90
- **THEN** Governor 在发送前主动压缩，任务不命中 `context_length_exceeded`

#### Scenario: Preflight gate catches a spike before send
- **WHEN** 发送前实际 token 达到预算 0.95
- **THEN** Governor 在发送前再次压缩，避免超窗错误

#### Scenario: Reactive gate recovers a context overflow error
- **WHEN** Provider 返回 `context_length_exceeded` 且 never-reset 标志未置位
- **THEN** Runtime 挂在 `provider_error` 分支的 Reactive 闸门触发压缩并重试一次模型调用，任务恢复而非直接失败

#### Scenario: Reactive gate does not retry a second time
- **WHEN** Reactive 闸门已重试一次后再次命中超窗
- **THEN** 任务 fail closed，MUST NOT 无限重试

#### Scenario: Boundary repair keeps tool pairs intact
- **WHEN** 压缩边界恰好落在 tool_use 与其 tool_result 之间
- **THEN** Governor 修复边界使成对完整性不被拆开，recent 段至少保留 3 对完整 tool_use/tool_result

### Requirement: Cache-Stable Context Projection
ContextGovernor MUST 替换基于"前删非 protected 原子"的投影路径，用"摘要段替换老段 + recent-tail append-only"产出模型面上下文。投影前缀 MUST 只随压缩事件变化，MUST NOT 每轮因前删而变化导致 prompt cache miss。Governor MUST 作为 `ContextBuilder.fitModelItems` 的入口，废弃前删路径但仍保持 `#items` append-only 语义（投影操作的是 clone，不改源）。Governor 投影 MUST 保持增量维护 spill/tier 状态，MUST NOT 每轮全量重算。

#### Scenario: Projection prefix stays stable across non-compaction turns
- **WHEN** 连续多轮模型调用期间未发生压缩事件
- **THEN** 投影前缀保持稳定，prompt cache 可命中，MUST NOT 因每轮前删而变化

#### Scenario: Source items remain append-only after projection
- **WHEN** Governor 产出压缩后的模型面上下文
- **THEN** append-only `#items` 源不被修改，ADR-0018 原件保留语义不变，投影只操作 clone

### Requirement: Governor Projection and Compactor Persistence Split
ContextGovernor MUST 只负责每轮的模型面投影（spill + 分层 + 三闸门），ConversationCompactor MUST 只负责 durable 摘要的持久化与 summary 回调。两者 MUST NOT 重复压缩。Governor 投影产生需要持久化的新摘要时 MUST 委托给 ConversationCompactor 持久化；Compactor MUST 不再做单阈值压缩，角色收窄为"durable 摘要持久化 + summary 回调"。摘要回调 MUST 复用 `SUMMARY_SYSTEM_PROMPT`（禁止采纳历史指令、输出秘密、调工具、推测）并经过 SecretRedactor。

#### Scenario: Governor delegates persistence to Compactor
- **WHEN** Governor 三闸门或分层产生需要持久化的新摘要
- **THEN** Governor 委托 ConversationCompactor 持久化 `ConversationCompaction` 记录，MUST NOT 自行落盘

#### Scenario: Compactor does not double-compress Governor output
- **WHEN** Governor 已投影出模型面上下文
- **THEN** Compactor MUST NOT 再次对已投影内容做单阈值压缩，两者职责不重叠

### Requirement: Context Recall Tool
系统 MUST 提供 `context_recall` 工具作为外溢结果的召回途径。工具签名 MUST 为 `{ toolCallId: string（必填，被外溢的原始 tool_result 的 toolCallId）, startLine?: integer, endLine?: integer, maxBytes?: integer }`。工具实现 MUST 从 append-only `#items` 按 `toolCallId` 查询原始 `tool_result`（复用 ADR-0018 原件保留，MUST NOT 冗余存储原始内容），并按 `startLine`/`endLine`/`maxBytes` 切片返回。召回片段 MUST 受 `maxBytes` 上限约束，MUST NOT 把超大结果又全量塞回模型面。`maxBytes` 未传或传入超大值时，Runtime MUST 应用默认 `maxBytes` 上限（MUST 在 ContextGovernor 初始化时配置，MUST NOT 超过单条 `tool_result` 外溢预算）。召回返回的片段 MUST 作为新的 `tool_result`（新 `toolCallId`）进入 `#items` 与模型面，受 Seen set 防全量回灌保护。`context_recall` MUST 是只读上下文管理工具——MUST NOT 访问 PTY、文件系统或 Provider keys，MUST NOT 改变任何状态，只查本会话历史。`context_recall` MUST 在 Runtime 内部短路执行——`#executeCalls` 识别 `name === 'context_recall'` 的调用时 MUST 直接从 Runtime `#items` 按 `toolCallId` 查询并切片返回，MUST NOT 经过外部 `RuntimeToolGateway`（Gateway 无法访问 `#items`）。`context_recall` MUST 登记为 Restricted Terminal Tools allowlist 的第 10 个工具。召回片段的脱敏：`#items` 内存态存的是脱敏前原始项，`context_recall` 取得的片段 MUST 经 Runtime 既有 `#emitItem`/`#redactItem` 脱敏路径发射与持久化（与 ADR-0018 原件保留精神一致）；崩溃恢复后 `#items` 从持久化（已脱敏）项重建，此时 `context_recall` 返回的也是已脱敏片段，行为与崩溃前一致。system prompt MUST 引导：`re-issuable` 工具优先重发更窄查询（拿最新结果），召回作为备选；`not-replayable` 工具用 `context_recall` 取回需要的片段。

#### Scenario: Model recalls a spilled not-replayable result fragment
- **WHEN** 模型对已被外溢的 `not-replayable` `toolCallId` 调用 `context_recall` 并指定 `startLine`/`endLine`/`maxBytes`
- **THEN** Runtime 从 `#items` 查原始 `tool_result`、按切片返回受限片段作为新 `tool_result`，原始内容未被冗余存储，片段受 `maxBytes` 约束

#### Scenario: Recall respects maxBytes bound
- **WHEN** 模型调用 `context_recall` 未传 `maxBytes` 或传入超大值
- **THEN** Runtime MUST 应用默认 `maxBytes` 上限（初始化时配置，不超过单条外溢预算），MUST NOT 把被外溢的完整结果全量塞回模型面

#### Scenario: Recall is read-only and session-scoped
- **WHEN** 模型调用 `context_recall`
- **THEN** 工具 MUST NOT 访问 PTY、文件系统或 Provider keys，MUST NOT 改变状态，只查本会话 `#items` 历史

#### Scenario: Recall short-circuits inside Runtime, not via Gateway
- **WHEN** `#executeCalls` 收到 `name === 'context_recall'` 的调用
- **THEN** Runtime MUST 直接从 `#items` 查询切片返回，MUST NOT 委托给外部 `RuntimeToolGateway`（后者无法访问 `#items`）

#### Scenario: Recalled fragment goes through redaction
- **WHEN** `context_recall` 从 `#items` 取得片段并作为新 `tool_result` 发射
- **THEN** 片段 MUST 经既有 `#emitItem`/`#redactItem` 脱敏路径，与 ADR-0018 原件保留精神一致；崩溃恢复后 `#items` 从已脱敏项重建，召回返回的也是已脱敏片段

#### Scenario: Re-issuable tools prefer re-issuance over recall
- **WHEN** 模型面对一个 `re-issuable` 工具的外溢结果
- **THEN** system prompt MUST 引导模型优先重发更窄查询以拿最新结果，`context_recall` 仅作为备选

### Requirement: Persisted Governance State
系统 MUST 持久化 `ContextGovernanceState`（conversationId + `spillRecords: ToolResultSpillRecord[]` + `tierClassifications: { toolCallId, tier, classifiedAtTurn }[]` + `seenToolCallIds: string[]` + `schemaVersion: number`）。`spillRecords` 中的 preview 头尾 MUST 有界（各 MUST NOT 超过 512 字节），MUST NOT 持久化完整原始结果内容。原始结果内容 MUST NOT 冗余持久化——仍在 append-only `#items`（ADR-0018 原件保留），`context_recall` 从 `#items` 查；`ContextGovernanceState` MUST 只持久化元数据 + 小 preview。`ContextGovernanceState` MUST 按 `conversationId` 整体 upsert（每次 `onGovernanceState` 回调整体替换该会话的治理状态，非增量 append）。版本化状态 MUST 支持向前兼容读取（类比 `ConversationCompaction`）：`schemaVersion` 初始为 1，旧数据缺字段时 MUST 以默认值补齐且 MUST NOT 崩溃或丢弃已有状态。ContextGovernor MUST 在每次产生新的 spill/tier 分类时通过 `onGovernanceState` 回调把 `ContextGovernanceState` 交回 coordinator 持久化。`onGovernanceState` 触发频率 MUST 有防抖（类比 Compaction 的防抖约 2s），MUST NOT 每次 spill/tier 变化都立即写盘导致高频 IO。崩溃恢复时 ContextGovernor MUST 从持久化 `ContextGovernanceState` 重建 spill/tier/Seen 状态，MUST NOT 重新分类、MUST NOT 重新外溢——分类可能调过摘要器（贵），重付不可接受。若持久化失败（如磁盘满），Governor MUST 视为 GovernanceState 不可用并 fail closed 或在下轮重建（容忍重分类成本），MUST NOT 让内存状态与持久化状态静默不一致。Governor 的增量状态 MUST 基于 `toolCallId`/`sequence` 而非 item 数组索引，避免 `#items` append 导致的 index 漂移。

#### Scenario: Governance state is persisted on new classification
- **WHEN** ContextGovernor 产生新的 spill 或 tier 分类
- **THEN** Governor 通过 `onGovernanceState` 回调把 `ContextGovernanceState` 交回 coordinator 持久化，元数据 + 小 preview 落盘，原始结果内容仍在 `#items` 未被冗余存储

#### Scenario: Governance state upserts by conversationId
- **WHEN** 同一会话多次产生 spill/tier 分类
- **THEN** Coordinator MUST 按 `conversationId` 整体 upsert `ContextGovernanceState`（整体替换，非增量 append）

#### Scenario: Crash recovery rebuilds governance state without re-classification
- **WHEN** runtime 崩溃后恢复并重建 ContextGovernor
- **THEN** Governor MUST 从持久化 `ContextGovernanceState` 加载 spill/tier/Seen 状态，MUST NOT 重新分类、MUST NOT 重新外溢，避免重付摘要器成本

#### Scenario: Versioned state recovers forward-compatibly
- **WHEN** 恢复时读取旧版本的持久化 `ContextGovernanceState`
- **THEN** 版本化状态 MUST 向前兼容读取，缺字段时以默认值补齐，MUST NOT 因 schema 版本差异而崩溃或丢弃已有状态

#### Scenario: Incremental state keyed by toolCallId not item index
- **WHEN** `#items` append 新项导致 item 数组索引漂移
- **THEN** Governor 的增量 spill/tier 状态仍以 `toolCallId`/`sequence` 为键定位，MUST NOT 因 index 漂移而错配

#### Scenario: Persistence failure fails closed or rebuilds
- **WHEN** `onGovernanceState` 回调中持久化 `ContextGovernanceState` 抛错
- **THEN** Governor MUST 视为 GovernanceState 不可用并 fail closed 或在下轮重建（容忍重分类成本），MUST NOT 让内存状态与持久化状态静默不一致
