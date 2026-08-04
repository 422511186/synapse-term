# structured-agent-progress Specification

## Purpose
规定不暴露隐藏推理的结构化 Agent 进度，以有界步骤、可观察结果和可恢复 checkpoint 支持多步任务的 UI 展示与安全收敛。

## Requirements

### Requirement: Structured Agent Progress
AgentRuntime MUST 暴露有界的 progress snapshot，其中包含 phase 和按顺序排列的 steps；steps 只能来自已接受的 Tool Call 和可观察的 runtime outcome。每个 step MUST 具有稳定 ID、安全 label、status 和可选 Tool Call evidence；progress MUST 不包含 chain-of-thought 或包含原始秘密的参数。

#### Scenario: Begin a multi-step task
- **WHEN** 新的 Agent Runtime 开始可调用 Tool 的 Turn
- **THEN** Runtime 发出不暴露隐藏推理的 `planning` progress phase

#### Scenario: Tool Call becomes an execution step
- **WHEN** Runtime 接受经过校验的 Tool Call
- **THEN** progress 增加一个以 Tool 名称为 label 的有界 step，并只在执行开始时将其标记为 running

#### Scenario: Tool Result completes a step
- **WHEN** Tool 返回 completed 或 failed 的可观察结果
- **THEN** progress 将对应 step 更新为相应终态，并关联 Tool Call ID 作为 evidence

### Requirement: Progress-aware Completion Review
Tool 使用后，Runtime MUST 在既有 completion review 校验原始目标和结构化 Tool evidence 时暴露 `verifying` phase。若 evidence 缺失，Runtime MUST 回到 `executing`，更新 progress 的新增 step，并继续既有有界 Tool Loop。

#### Scenario: Review finds missing evidence
- **WHEN** completion review 判断某项所需的可观察结果缺失
- **THEN** Runtime 发出 verifying-to-executing progress transition，并使用既有 Tool 继续执行，而不是完成 Turn

#### Scenario: Review confirms completion
- **WHEN** completion review 确认所有目标都有 evidence
- **THEN** Runtime 将 progress 标记为 completed，并只发布经过复核的最终答案

### Requirement: Recoverable Progress Checkpoint
Approval 和可恢复等待 checkpoint MUST 包含当前 progress snapshot，并在剩余 Tool Call 继续前恢复它。取消、断连、循环上限和失败 MUST 以可观察的终态 phase 结束 progress。

#### Scenario: Resume after approval
- **WHEN** Tool step 因审批暂停且用户批准
- **THEN** Runtime 恢复该 step 及其之前的 status，继续同一个 Tool Call，并不得创建重复 step

#### Scenario: Cancel during execution
- **WHEN** 用户在 progress step 或 model run 活动期间取消
- **THEN** Runtime 发出 cancelled 终态 progress，不得在没有 evidence 时把 step 标记为 completed

### Requirement: Safe Progress Projection
Core 和 Desktop MUST 使用稳定 timeline identity 和有界结构化字段投影 progress。Progress 是信息状态，不是授权决策，MUST 不改变 Policy、Approval、Lease、Tool Schema 或 Session binding 行为。

#### Scenario: Renderer receives a progress update
- **WHEN** Core 为同一 Turn 发送更新的 progress snapshot
- **THEN** Renderer 在一个 progress item 中替换之前的 snapshot，并显示 phase、step status 和 evidence-safe label

#### Scenario: Progress contains a malicious Tool argument
- **WHEN** Tool 参数或结果包含指令、秘密或过量输出
- **THEN** progress projection 省略原始参数/结果内容，只保留有界安全 metadata
