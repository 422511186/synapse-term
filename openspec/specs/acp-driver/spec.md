# acp-driver Specification

## Purpose
规定 ACP 外部 Agent 作为受控 CLI 子进程接入 Synapse Term 的生命周期、能力声明、权限请求、Turn 映射和会话投影边界。
## Requirements
### Requirement: External Agent Subprocess Lifecycle
平台 MUST 以 CLI 子进程形态启动 ACP 外部 Agent，且仅当用户显式完成两级动作（设置页允许 ACP 集成 + 在面板选择驱动者并开始任务）后才 spawn。一个 Agent Conversation MUST 对应一个长驻子进程；Conversation 关闭或应用退出 MUST 终止该进程。

#### Scenario: Driver selected but not started
- **WHEN** 用户只启用了全局 ACP 设置但未在任何面板开始外部 Agent 任务
- **THEN** 平台不得 spawn 任何外部 Agent 进程

#### Scenario: Agent process crashes
- **WHEN** 外部 Agent 子进程意外退出而 Conversation 仍存在
- **THEN** 当前 Turn 进入 failed，子进程不自动重启，用户开启新 Conversation 时重新 spawn

### Requirement: ACP Client Capability Declaration
平台作为 ACP 客户端 MUST 只声明终端执行与只读文件两类能力，不得声明编辑、搜索、索引或其他写能力；外部 Agent 提出的非声明能力调用 MUST 被拒绝并审计。

#### Scenario: Agent requests an undeclared capability
- **WHEN** 外部 Agent 尝试使用平台未声明的文件编辑能力
- **THEN** 平台拒绝该调用并记录审计，用户面板显示拒绝原因

### Requirement: Single Approval Channel
ACP permission request MUST 由平台 Policy 统一裁决：Policy 可自动裁决时返回 allow_once；需要人工时复用现有审批 UI；非平台工具自动拒绝并审计。平台 MUST NOT 采用 allow_always / reject_always 记忆语义。

#### Scenario: Agent requests permission for a platform tool
- **WHEN** 外部 Agent 对平台工具发起 permission request
- **THEN** 平台按 Policy 返回 allow_once 或路由到现有审批，用户不会看到第二套审批界面

#### Scenario: Agent requests permission for a native tool
- **WHEN** 外部 Agent 对自身原生工具发起 permission request
- **THEN** 平台拒绝并审计该请求，不转发 allow_always 类授权

### Requirement: ACP Turn State Mapping
外部 Agent 的 stopReason MUST 映射到现有 Turn 终态：end_turn 与 refusal 映射 completed，cancelled 映射 cancelled，max_tokens、max_turn_requests 与错误映射 failed；ACP 事件 MUST 翻译为现有 timeline 事件流。

#### Scenario: Agent ends turn normally
- **WHEN** 外部 Agent 返回 stopReason=end_turn
- **THEN** Turn 进入 completed 且时间线显示最终助手文本

#### Scenario: Agent hits token budget
- **WHEN** 外部 Agent 返回 stopReason=max_tokens
- **THEN** Turn 进入 failed 且不显示成功结论

### Requirement: Driver-Separated Conversation History
Agent Conversation MUST 携带 driver 维度（builtin | acp）；内置与外部驱动者的 Conversation 历史 MUST 各自独立，切换驱动者 MUST 切换显示对应历史。外部驱动者的 Turn MUST 允许模型选择为空。

#### Scenario: Switch driver in agent panel
- **WHEN** 用户在内置 Agent 历史存在时切换到外部驱动者
- **THEN** 面板显示外部驱动者的独立 Conversation，内置历史保持不动且不可被外部驱动者追加

#### Scenario: External turn without model selection
- **WHEN** 外部驱动者启动一个 Turn
- **THEN** Turn 的模型选择字段为空且不产生 Provider 快照

### Requirement: Conversation Projection Storage
平台 MUST 为外部驱动者保存 Conversation Projection（user_text、assistant_text、工具调用摘要），用于展示、审计与恢复提示；完整上下文 MUST 由外部 Agent 进程自管，平台不得把投影作为模型上下文重放给外部 Agent。

#### Scenario: Timeline renders external agent progress
- **WHEN** 外部 Agent 发送文本增量与工具调用更新
- **THEN** 平台追加对应投影项，面板 timeline 正常渲染且审计可见

### Requirement: Approval Request Entry Lifecycle
ACP 控制器维护的全局审批请求表 MUST 在审批请求达到终态时清理对应条目：`respondApproval` 成功消费后 MUST 删除该条目；会话取消、进程终止或 Agent 退出时 MUST 批量清理该会话相关的全部未决审批条目，MUST NOT 产生永不释放的累积条目。

#### Scenario: Approval is responded
- **WHEN** 用户对某 approvalId 做出批准或拒绝
- **THEN** 控制器 MUST 在消费后从全局表中删除该条目

#### Scenario: Session is cancelled or process exits
- **WHEN** 会话被取消、外部 Agent 子进程退出或被终止
- **THEN** 控制器 MUST 清理该会话下所有未决审批条目，全局表不得残留孤立条目

