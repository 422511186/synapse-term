## ADDED Requirements

### Requirement: Current Environment Context Before Model Execution

AgentCoordinator MUST 在 Agent 首次向 Provider 请求模型输出前，确保当前 PTY environment 已完成有界 Probe，并向模型上下文提供当前 dialect、platform、operatingSystem、verificationStatus 和 capability epoch。模型 MUST 将该摘要视为当前执行目标事实，不得仅根据 `bash`/POSIX 方言推断 Linux。

#### Scenario: Windows Git Bash environment

- **WHEN** 当前 PTY 是 Windows Git Bash，Shell dialect 为 `posix`
- **THEN** 模型上下文明确包含 Windows operatingSystem 和已验证 capability epoch，Agent 不应把 POSIX 方言当作 Linux 证据

#### Scenario: SSH changes the current PTY target

- **WHEN** 用户通过 SSH、容器或嵌套 Shell 改变当前 PTY 的目标环境后再次请求 Agent 结构化执行
- **THEN** Core 使旧 environment epoch 失效、重新 Probe 当前 PTY，并把新环境摘要传给后续模型请求

#### Scenario: Environment cannot be identified

- **WHEN** environment Probe 超时、返回歧义结果或无法识别操作系统
- **THEN** Agent 保持 observation-only，不向 Provider 请求需要结构化执行的模型轮次，也不生成基于猜测的审批

### Requirement: Error Recovery Does Not Repeat an Unchanged Command

AgentRuntime MUST 将 `command_not_found`、环境不匹配或相同 Tool Call 的无进展错误作为新证据处理；在没有新上下文或命令变化时 MUST NOT 自动再次提交同一个命令并重新触发相同审批。

#### Scenario: Platform-incompatible command fails

- **WHEN** 一个命令因当前环境不支持而失败
- **THEN** Agent 将失败结果交给模型选择平台适配的替代方案，或停止并报告限制，不能无变化地再次请求同一命令

#### Scenario: Failed command is displayed

- **WHEN** Tool Result 表示命令失败
- **THEN** 时间线显示失败结果和最终状态，不能把失败结果渲染为已完成，也不能创建隐藏的重复执行

### Requirement: Task Cancellation During Blocking States

Agent Task MUST 在等待人工审批、环境 Probe、Provider 输出或 Tool Result 时响应用户取消；取消 MUST 清理 pending approval、停止后续模型/Tool 调用、释放 Session Lease，并产生唯一的 cancelled 任务状态。

#### Scenario: Cancel while approval is pending

- **WHEN** Agent 正在等待命令审批且用户点击取消任务
- **THEN** Core 取消待审批项、任务进入 `cancelled`，后续点击旧审批不得恢复模型或执行命令

#### Scenario: Cancel while model or probe is active

- **WHEN** Agent 正在运行模型或 environment Probe 且用户点击取消任务
- **THEN** 取消信号终止后续处理，晚到的模型/Probe结果不得重新建立活动 Agent Task
