# provider-backed-context-summarization Specification

## Purpose
规定对话自动压缩时的 Provider 摘要、确定性证据 fallback、预算、脱敏和审计边界，提升长对话上下文质量而不改变原始记录的事实地位。

## Requirements

### Requirement: Provider-backed Conversation Summary
自动压缩需要发生时，Core MUST 在应用 SecretRedactor 后，使用当前 Turn 的 Provider 和 Model 尝试一次无 Tool 的摘要 Model Run。摘要请求 MUST 使用独立输出预算，且不得计入用户 Tool Call。

#### Scenario: Provider summary succeeds
- **WHEN** 需要压缩且 Provider 在摘要预算内返回非空文本、没有 Tool Call 或 Provider error
- **THEN** Core 使用该文本作为持久化 compaction summary，并记录使用了 Provider 摘要

#### Scenario: Provider summary fails
- **WHEN** 摘要流式调用失败、超时、取消、返回空响应或发出 Tool Call
- **THEN** Core 使用确定性 fallback，用户 Turn 继续执行，不把摘要失败暴露为用户 Tool failure，并记录 fallback method

### Requirement: Deterministic Evidence Fallback
确定性 fallback summary MUST 保留有界的用户目标、Assistant 结论、已执行 Tool 名称及相关参数、Tool 结果/错误和未完成事项证据。摘要在持久化或发送给 Provider 前 MUST 脱敏。

#### Scenario: Long Tool result is compacted
- **WHEN** 旧 Tool Result 超过单条摘要边界
- **THEN** fallback 保留带 Tool 身份和错误状态的有界脱敏表示，同时原始 Model Item 仍可从历史存储查询

#### Scenario: Existing summary is already over budget
- **WHEN** 既有 compaction summary 单独超过配置阈值
- **THEN** compactor 重新 fitting 摘要内容，MUST 不返回超过阈值的 history；如果最小 system summary 无法容纳则以稳定的 context budget error fail closed

### Requirement: Summary Budget and Audit Boundaries
每个生成的 compaction history MUST 在配置的 token threshold 内。摘要执行 MUST 具有有界的 timeout、输出大小、取消和递归行为；compaction audit MUST 包含 source sequence、estimated input tokens 和 summary method，且不得持久化秘密。

#### Scenario: Provider emits oversized summary
- **WHEN** Provider 摘要文本超过可用 summary budget
- **THEN** Core 拒绝该文本并使用有界确定性 fallback，不得返回超预算 history

#### Scenario: Summary input contains a secret
- **WHEN** 被压缩的 Model Item 包含 SecretRedactor 可识别的 credential 或 token
- **THEN** Provider request、持久化 summary、audit payload 和 fallback 均不得包含秘密原文
