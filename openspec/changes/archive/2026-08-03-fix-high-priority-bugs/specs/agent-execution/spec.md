# agent-execution Delta

## ADDED Requirements

### Requirement: Agent Turn Reasoning Effort Default
当调用方未显式传入 `reasoningEffort` 且已绑定模型时，AgentCoordinator MUST 使用该模型配置的 `defaultReasoningEffort` 作为默认值，MUST NOT 使用硬编码常量；当模型未声明 `defaultReasoningEffort` 时 MAY 省略该字段。所选 `reasoningEffort` MUST 落在模型 `supportedReasoningEfforts` 集合内，否则 MUST 回退到模型声明的默认值或省略。

#### Scenario: Model declares a default reasoning effort
- **WHEN** 调用方未传入 `reasoningEffort` 且绑定模型的 `defaultReasoningEffort` 为 `high`
- **THEN** 创建出的 Agent Turn 持有 `reasoningEffort: 'high'`，且不出现模型不支持的值

#### Scenario: Model only supports a restricted set
- **WHEN** 绑定模型只支持 `['high', 'xhigh']` 且未显式传入 `reasoningEffort`
- **THEN** Agent Turn 的 `reasoningEffort` MUST 取自该模型 `defaultReasoningEffort`，MUST NOT 为硬编码的 `low`

### Requirement: Agent Task Startup Failure Rollback
AgentCoordinator 在创建 running Agent Task 并持久化后、将 state 入表前若抛错，MUST 回滚已写入的 running Task（转回 `failed` 并持久化），MUST NOT 留下孤立 running Task 或污染 `activeTaskCount`。

#### Scenario: Persistence fails after task created
- **WHEN** `start` 在 task 已 `scheduler.start` 并 `saveAgentTask(running)` 后、state 入表前抛错
- **THEN** Coordinator MUST 把该 task 转为 `failed` 并持久化，后续 `cancel` 不得因找不到 state 而遗留脏数据

#### Scenario: Adapter creation throws
- **WHEN** `createAdapter` 在 state 入表前抛错
- **THEN** 已创建的 running Task MUST 被回滚，`activeTaskCount` 不计该任务

### Requirement: Approval Epoch Mismatch Lease Handling
当 `approve` 在 environment epoch 不匹配时取消任务，Coordinator MUST 视同存在 pending approval 来决定环境失效与 Lease 回收路径，MUST NOT 因提前清空 `pendingApproval` 而走"返回 Lease 给用户"分支导致用户拿到指向过期环境的 Lease。

#### Scenario: Approve with stale environment epoch
- **WHEN** 用户批准一个 command 但其 `environmentEpoch` 与当前 capability epoch 不匹配
- **THEN** Coordinator MUST 取消任务并强制 takeover 用户环境（失效旧 epoch），MUST NOT 把 Agent Lease 直接归还用户指向过期环境

### Requirement: Bounded Conversation Compaction Result
对话压缩器返回的历史 MUST NOT 超过配置的压缩阈值；当已有摘要本身已超阈值且新条目无法进一步压缩时，压缩器 MUST 将已有摘要并入重新摘要，MUST NOT 原样返回超限历史。

#### Scenario: Existing summary already exceeds threshold
- **WHEN** 已有摘要的 token 数已超过 `thresholdTokens` 且本批次新条目 token 总和不超过 `targetTokens`
- **THEN** 压缩器 MUST 产出包含旧摘要内容的新摘要，返回历史总 token 数 MUST NOT 超过阈值

#### Scenario: All new turns fit within target
- **WHEN** 新条目 token 总和不超过 `targetTokens` 但加上已有摘要后仍超阈值
- **THEN** 压缩器 MUST 触发对已有摘要与新条目的合并摘要，MUST NOT 直接返回已有摘要加全部新条目
