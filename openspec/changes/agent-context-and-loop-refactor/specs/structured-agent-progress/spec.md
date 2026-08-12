## MODIFIED Requirements

### Requirement: Structured Agent Progress
AgentRuntime MUST 暴露有界的 progress snapshot，其中包含 phase 和按顺序排列的 steps；steps 只能来自已接受的 Tool Call 和可观察的 runtime outcome。每个 step MUST 具有稳定 ID、安全 label、status 和可选 Tool Call evidence；progress MUST 不包含 chain-of-thought 或包含原始秘密的参数。`planning` phase MUST 反映真实任务分解（详见 `Plan-Then-Execute Decomposition` 要求），MUST NOT 仅作为 UI 相位标签。

#### Scenario: Begin a multi-step task
- **WHEN** 新的 Agent Runtime 开始可调用 Tool 的 Turn
- **THEN** Runtime 发出不暴露隐藏推理的 `planning` progress phase，该 phase MUST 由 TaskPlanner 产出的 `DecompositionResult` 支撑而非空标签

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
Approval 和可恢复等待 checkpoint MUST 包含当前 progress snapshot，并在剩余 Tool Call 继续前恢复它。取消、断连、循环上限和失败 MUST 以可观察的终态 phase 结束 progress。子任务边界 MUST 作为天然 checkpoint 打 marker，`InProgress⟺marker` 不变量 MUST 在每条持久化路径上维护：有 marker 则必有 InProgress 子任务，反之亦然。取消 MUST 清除 marker。

#### Scenario: Resume after approval
- **WHEN** Tool step 因审批暂停且用户批准
- **THEN** Runtime 恢复该 step 及其之前的 status，继续同一个 Tool Call，并不得创建重复 step

#### Scenario: Cancel during execution
- **WHEN** 用户在 progress step 或 model run 活动期间取消
- **THEN** Runtime 发出 cancelled 终态 progress，不得在没有 evidence 时把 step 标记为 completed，并 MUST 清除子任务 marker

#### Scenario: Subtask boundary checkpoint marker is invariant
- **WHEN** Planning 进入新子任务边界并落盘
- **THEN** 持久化路径 MUST 维护 `InProgress⟺marker` 不变量，崩溃恢复时不会出现孤儿 marker 或遗漏 InProgress 子任务

### Requirement: Safe Progress Projection
Core 和 Desktop MUST 使用稳定 timeline identity 和有界结构化字段投影 progress。Progress 是信息状态，不是授权决策，MUST 不改变 Policy、Approval、Lease、Tool Schema 或 Session binding 行为。

#### Scenario: Renderer receives a progress update
- **WHEN** Core 为同一 Turn 发送更新的 progress snapshot
- **THEN** Renderer 在一个 progress item 中替换之前的 snapshot，并显示 phase、step status 和 evidence-safe label

#### Scenario: Progress contains a malicious Tool argument
- **WHEN** Tool 参数或结果包含指令、秘密或过量输出
- **THEN** progress projection 省略原始参数/结果内容，只保留有界安全 metadata

## ADDED Requirements

### Requirement: Plan-Then-Execute Decomposition
AgentRuntime MUST 在 `planning` phase 用 LLM 产出 `DecompositionResult`（mode / complexity / subtasks / strategy），每个 `Subtask` MUST 包含 Dependencies、Produces、Consumes 与 Boundaries（InScope/OutOfScope）。确定性代码 MUST 按依赖拓扑排序执行子任务，MUST NOT 让 LLM 直接控制执行顺序。分解覆盖率 MUST ≥0.85 且零 critical gaps，不达标 MUST 走定向 replanning（针对缺口发定向子查询），MUST NOT 从头重规划。MaxIterations MUST 为 3。简单任务 MUST 跳过分解（附录B Occam 剃刀），门控信号至少包含"目标包含多步动词 / 用户显式 `/plan` / ContextBuilder 估算超过 N 步"组合启发式之一。Planning 本体先无状态——崩溃即从用户目标重规划，因副作用安全已由 approval/lease/audit 保障。

#### Scenario: Multi-step goal is decomposed
- **WHEN** 用户提交包含多步动词的目标且门控判定需要分解
- **THEN** TaskPlanner 产出 `DecompositionResult`，确定性代码按依赖拓扑排序执行子任务，`planning` phase 反映真实分解而非空标签

#### Scenario: Coverage below threshold triggers targeted replanning
- **WHEN** 分解覆盖率低于 0.85 或存在 critical gap
- **THEN** Runtime 走定向 replanning（针对缺口发定向子查询），MUST NOT 从头重规划，MaxIterations 不超过 3

#### Scenario: Simple task skips decomposition
- **WHEN** 门控判定目标为简单任务（不含多步动词、无显式 `/plan`、估算步数低于阈值）
- **THEN** Runtime 跳过分解直接进入 ReAct，避免无谓的 LLM 规划延迟

#### Scenario: Planning is stateless on crash
- **WHEN** Planning 期间发生崩溃
- **THEN** 恢复时从用户目标重新规划，不依赖未落盘的规划中间态，因副作用安全已由 approval/lease/audit 保障

#### Scenario: Replanning skips completed side-effecting subtasks
- **WHEN** 崩溃发生在一个有副作用的子任务之后、下一个子任务之前，恢复后触发重规划
- **THEN** Runtime MUST 先读持久化 `subtaskMarkers` 跳过已完成的副作用子任务，并在 LLM 规划 prompt 里注入"已完成子任务清单"，MUST NOT 盲目重放已完成的副作用子任务；副作用命令重放仍经 approval/lease/audit 审批兜底
