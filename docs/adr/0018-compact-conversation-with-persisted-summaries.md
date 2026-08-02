# ADR-0018：用持久化摘要压缩对话上下文

状态：已实现

## 决策

达到模型配置的上下文阈值时，将较早的结构化 Model Item 生成持久摘要，后续请求使用摘要和近期精确条目。原始条目不删除。

## 当前实现

`ConversationCompactor` 和 `ContextBuilder` 位于 `@synapse-term/agent-service`，摘要记录由 Infrastructure Repository 持久化；Tool Call 与 Tool Result 的原子关系不会被拆开。

## 影响

模型上下文受预算控制且保留关键决策，UI 历史和审计仍可查看完整原始条目；摘要本身仍要经过秘密保护。
