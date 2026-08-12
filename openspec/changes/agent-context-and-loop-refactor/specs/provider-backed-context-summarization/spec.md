## MODIFIED Requirements

### Requirement: Provider-backed Conversation Summary
自动压缩需要发生时，Core MUST 在应用 SecretRedactor 后，使用当前 Turn 的 Provider 和 Model 尝试一次无 Tool 的摘要 Model Run。摘要请求 MUST 使用独立输出预算，且不得计入用户 Tool Call。压缩摘要写完即落盘（provider 摘要是贵的，崩溃重付不可接受），MUST NOT 在内存中滞留后才持久化。`ConversationCompaction` 记录 MUST 扩展 `gate` 字段（标识压缩来源：`proactive` / `preflight` / `reactive` / `layered`）与 `tier` 字段（标识分层来源：`tier3` / `tier2` / `tier1`）以区分压缩来源。恢复的 Turn MUST 恒为 unattended（不继承原会话特权）。

#### Scenario: Provider summary succeeds
- **WHEN** 需要压缩且 Provider 在摘要预算内返回非空文本、没有 Tool Call 或 Provider error
- **THEN** Core 使用该文本作为持久化 compaction summary，记录使用了 Provider 摘要，并立即落盘 `ConversationCompaction`（含 `gate`/`tier` 字段）

#### Scenario: Provider summary fails
- **WHEN** 摘要流式调用失败、超时、取消、返回空响应或发出 Tool Call
- **THEN** Core 使用确定性 fallback，用户 Turn 继续执行，不把摘要失败暴露为用户 Tool failure，并记录 fallback method，fallback 摘要同样立即落盘

#### Scenario: Recovered turn is always unattended
- **WHEN** 因崩溃恢复而重新执行的 Turn
- **THEN** 该 Turn MUST 恒为 unattended，MUST NOT 继承原会话的特权或审批状态

### Requirement: Deterministic Evidence Fallback
确定性 fallback summary MUST 保留有界的用户目标、Assistant 结论、已执行 Tool 名称及相关参数、Tool 结果/错误和未完成事项证据。摘要在持久化或发送给 Provider 前 MUST 脱敏。

#### Scenario: Long Tool result is compacted
- **WHEN** 旧 Tool Result 超过单条摘要边界
- **THEN** fallback 保留带 Tool 身份和错误状态的有界脱敏表示，同时原始 Model Item 仍可从历史存储查询

#### Scenario: Existing summary is already over budget
- **WHEN** 既有 compaction summary 单独超过配置阈值
- **THEN** compactor 重新 fitting 摘要内容，MUST 不返回超过阈值的 history；如果最小 system summary 无法容纳则以稳定的 context budget error fail closed

### Requirement: Summary Budget and Audit Boundaries
每个生成的 compaction history MUST 在配置的 token threshold 内。摘要执行 MUST 具有有界的 timeout、输出大小、取消和递归行为；compaction audit MUST 包含 source sequence、estimated input tokens、summary method、`gate` 和 `tier` 字段，且不得持久化秘密。

#### Scenario: Provider emits oversized summary
- **WHEN** Provider 摘要文本超过可用 summary budget
- **THEN** Core 拒绝该文本并使用有界确定性 fallback，不得返回超预算 history

#### Scenario: Summary input contains a secret
- **WHEN** 被压缩的 Model Item 包含 SecretRedactor 可识别的 credential 或 token
- **THEN** Provider request、持久化 summary、audit payload 和 fallback 均不得包含秘密原文

## ADDED Requirements

### Requirement: Compaction Summary Persistence Minimal Subset
压缩摘要 MUST 在写完即落盘（防抖约 2s 内），MUST NOT 仅在内存中维护。落盘的 `ConversationCompaction` 是 Ch40 最小子集的 checkpoint——丢失即重付全部 provider 摘要成本。取消 MUST 清除 InProgress marker，MUST NOT 留下孤儿 marker。`InProgress⟺marker` 不变量 MUST 在 ConversationCompactor.persist 与 Runtime 取消路径上集中维护。版本化状态 MUST 支持向前兼容的恢复读取。

#### Scenario: Summary is persisted immediately after write
- **WHEN** ContextGovernor 三闸门或分层产生新的持久化摘要
- **THEN** ConversationCompactor 在防抖约 2s 内落盘 `ConversationCompaction`，崩溃后不会重付全部 provider 摘要成本

#### Scenario: Cancel clears in-progress marker
- **WHEN** 用户在摘要写入期间取消任务
- **THEN** Runtime 清除 InProgress marker，MUST NOT 留下孤儿 marker 导致恢复时误判为有未完成子任务

#### Scenario: Versioned state recovers forward-compatibly
- **WHEN** 恢复时读取旧版本的持久化 compaction 状态
- **THEN** 版本化状态 MUST 向前兼容读取，MUST NOT 因 schema 版本差异而崩溃或丢弃已有摘要

### Requirement: Persisted Context Governance State
ContextGovernor 产生 spill/tier/Seen 分类时，Core MUST 通过 `onGovernanceState` 回调把 `ContextGovernanceState`（conversationId + `spillRecords`（preview 头尾各 ≤512 字节）+ `tierClassifications` + `seenToolCallIds` + `schemaVersion: number` 初始 1）交回 coordinator 持久化。原始结果内容 MUST NOT 冗余持久化——仍在 append-only `#items`（ADR-0018 原件保留），`context_recall` 从 `#items` 查；`ContextGovernanceState` MUST 只持久化元数据 + 小 preview。`ContextGovernanceState` MUST 按 `conversationId` 整体 upsert（整体替换，非增量 append）。`onGovernanceState` 触发频率 MUST 有防抖（类比 Compaction 防抖约 2s），MUST NOT 每次 spill/tier 变化都立即写盘导致高频 IO。崩溃恢复时 ContextGovernor MUST 从持久化 `ContextGovernanceState` 重建 spill/tier/Seen 状态，MUST NOT 重新分类、MUST NOT 重新外溢——分类可能调过摘要器（贵），重付不可接受。版本化状态 MUST 支持向前兼容读取（`schemaVersion` 初始为 1，旧数据缺字段时以默认值补齐且 MUST NOT 崩溃或丢弃已有状态）。若持久化失败（如磁盘满），Governor MUST 视为 GovernanceState 不可用并 fail closed 或在下轮重建（容忍重分类成本），MUST NOT 让内存状态与持久化状态静默不一致。Governor 的增量状态 MUST 基于 `toolCallId`/`sequence` 而非 item 数组索引，避免 `#items` append 导致的 index 漂移。

#### Scenario: Governance state persisted on new classification
- **WHEN** ContextGovernor 产生新的 spill 或 tier 分类
- **THEN** Core 通过 `onGovernanceState` 回调把 `ContextGovernanceState` 持久化（防抖约 2s），元数据 + 小 preview 落盘，原始结果内容仍在 `#items` 未被冗余存储

#### Scenario: Governance state upserts by conversationId
- **WHEN** 同一会话多次产生 spill/tier 分类
- **THEN** Coordinator MUST 按 `conversationId` 整体 upsert `ContextGovernanceState`（整体替换，非增量 append）

#### Scenario: Crash recovery rebuilds governance state without re-classification
- **WHEN** runtime 崩溃后恢复并重建 ContextGovernor
- **THEN** Governor MUST 从持久化 `ContextGovernanceState` 加载 spill/tier/Seen 状态，MUST NOT 重新分类、MUST NOT 重新外溢，避免重付摘要器成本

#### Scenario: Versioned state recovers forward-compatibly
- **WHEN** 恢复时读取旧版本的持久化 `ContextGovernanceState`
- **THEN** 版本化状态 MUST 向前兼容读取，缺字段时以默认值补齐，MUST NOT 因 schema 版本差异而崩溃或丢弃已有状态

#### Scenario: Persistence failure fails closed or rebuilds
- **WHEN** `onGovernanceState` 回调中持久化 `ContextGovernanceState` 抛错
- **THEN** Governor MUST 视为 GovernanceState 不可用并 fail closed 或在下轮重建（容忍重分类成本），MUST NOT 让内存状态与持久化状态静默不一致

#### Scenario: Incremental state keyed by toolCallId not item index
- **WHEN** `#items` append 新项导致 item 数组索引漂移
- **THEN** Governor 的增量 spill/tier 状态仍以 `toolCallId`/`sequence` 为键定位，MUST NOT 因 index 漂移而错配
