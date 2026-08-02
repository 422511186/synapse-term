## ADDED Requirements

### Requirement: Session Conversation History
系统 MUST 为每个 Session 维护可重置的 Agent Conversation，并将用户消息、assistant 文本、Tool Call 和 Tool Result 作为有界结构化历史供后续 Turn 使用。

#### Scenario: Continue a conversation
- **WHEN** 用户在同一 Session 中发送第二条消息
- **THEN** 模型收到该 Conversation 的相关历史且无需把前一条消息创建为无关孤立任务

#### Scenario: Reset a conversation
- **WHEN** 用户显式开始新对话
- **THEN** 后续 Turn 不再包含旧 Conversation 历史且旧审计仍保留

### Requirement: Text-Only Agent Turn
AgentRuntime MUST 允许模型在不调用任何 Tool 时直接完成普通对话，并且 SHALL 不运行 ShellProbe、不获取终端输入 Lease或向 PTY 写入字节。

#### Scenario: Ask what the Agent can do
- **WHEN** 用户发送不需要终端或文件证据的普通问题
- **THEN** Agent 返回自然语言回复且当前 PTY 输出不包含 Agent Probe 或命令

### Requirement: Agent System Prompt Contract
ContextBuilder MUST 产生版本化且可契约测试的系统提示词，明确 Session 绑定、Tool 使用条件、证据优先、不可伪造结果、Permission Mode 边界、交互式接管、可恢复错误和最终回复结构，且 MUST NOT 要求暴露隐藏推理过程。

#### Scenario: Build context for a diagnostic turn
- **WHEN** 用户请求诊断当前 Session 中的服务问题
- **THEN** 系统提示词要求模型仅通过显式 Tool 获取终端或文件证据、不得伪造执行结果，并在最终回复中说明证据、操作、结论与未解决风险

#### Scenario: Terminal requires unsupported interaction
- **WHEN** Tool Result 表明终端正在等待密码、TUI 或任意按键
- **THEN** 系统提示词要求模型停止自动输入、说明原因并请求用户接管

### Requirement: Recoverable Tool Feedback
可恢复 Tool 错误 MUST 作为结构化 Tool Result 返回模型，使 Agent 可以调整方案继续循环；只有越权、协议破坏或达到循环限制时才终止 Turn。

#### Scenario: Command is unavailable
- **WHEN** `terminal_execute` 返回可恢复的 command-not-found 结果
- **THEN** AgentRuntime 把错误加入下一轮模型输入并允许模型选择替代命令

### Requirement: Bounded Autonomous Loop
AgentRuntime MUST 对 Model Run 数、Tool Call 数、总时长和重复无进展调用设置可配置硬限制，并在达到限制时产生可见失败。

#### Scenario: Model repeats the same failing tool
- **WHEN** 模型连续达到配置次数调用相同 Tool 和参数且得到相同失败
- **THEN** Runtime 停止循环、记录原因并向用户显示已有结果摘要

### Requirement: Post-Tool Completion Review
AgentRuntime MUST 在一个 Turn 已调用过任一 Tool 后，把首次无 Tool Call 的 assistant 文本视为候选答案，并使用同一模型选择、原始用户目标和结构化 Tool 证据执行有界完成性复核。候选答案 MUST NOT 作为 assistant item 进入复核模型上下文；复核发现目标未完成时 MUST 继续现有 Tool Loop，确认完成后 SHALL 只发布并持久化一次完整、自包含且不引用隐藏候选文本的最终答案。候选答案和内部复核指令 MUST NOT 进入用户 Timeline 或 Conversation 历史。

#### Scenario: Model stops after partial diagnostics
- **WHEN** 用户要求检查多个服务器指标，模型只执行其中一部分 Tool 后输出“全部完成”且没有 Tool Call
- **THEN** Runtime 不完成 Turn、不发布该候选文本，并发起完成性复核；复核识别缺失证据后继续调用现有 Terminal Tool，直到确认目标完成或达到硬限制

#### Scenario: Complete a pure conversation without review
- **WHEN** 模型在当前 Turn 从未调用 Tool 并直接回答普通对话
- **THEN** Runtime 实时发布该文本并直接完成 Turn，不增加完成性复核 Model Run

#### Scenario: Completion review limit is exhausted
- **WHEN** 工具任务连续达到配置的完成性复核次数仍无法确认完成
- **THEN** Runtime 以稳定可见错误终止，不发布未复核候选答案，且所有已执行 Tool 和审计证据仍保留

#### Scenario: Reviewer would reuse the hidden candidate
- **WHEN** 候选答案不会展示给用户且完成性复核确认全部目标已有证据
- **THEN** 复核模型只根据原目标和 Tool 证据生成完整、自包含的最终答复，不得回答“沿用上一条报告”或引用其他不可见文本

### Requirement: Just-in-Time Terminal Lease
Agent MUST 仅在 `terminal_execute` 即将向 PTY 写入时获取 Session Lease 和验证 Shell capability；观察、文件操作和普通对话不得占用终端输入控制权。

#### Scenario: Read a local file while user owns terminal input
- **WHEN** Agent 只调用本机文件 Tool
- **THEN** 用户仍保持 Terminal Session 输入 Lease且 Agent 不运行 ShellProbe

### Requirement: Configurable Context Budget
每个用于 Agent 的 Model Configuration MUST 提供可配置 context window、输出预留、自动压缩开关和压缩阈值；Core SHALL 在每次 Model Run 前计算 Context Budget，不能把超限请求直接发送给 Provider。

#### Scenario: Conversation approaches the configured window
- **WHEN** 结构化历史估算 Token 达到配置的压缩阈值
- **THEN** Core 在保留系统规则、近期精确消息和输出 headroom 的前提下自动压缩较旧历史

### Requirement: Persisted Conversation Compaction
自动压缩 MUST 生成可追踪的持久摘要并在后续 Model Run 中替代较旧 Item，同时 SHALL 保留原始 Conversation、Tool 和审计记录。

#### Scenario: Continue after compaction
- **WHEN** 用户在已压缩 Conversation 中继续提问
- **THEN** 模型收到摘要与近期精确历史，旧消息仍可由本地历史和审计查询

### Requirement: Per-Turn Model Controls
每个 Agent Turn MUST 保存实际 `modelConfigurationId` 与 revision、解析后的 Provider Profile 与 revision、模型 ID、能力快照和 `low | medium | high | xhigh` 推理强度；桌面端 SHALL 允许用户在发送前从已启用 Model Configuration 列表切换，且产品 UI 使用这四个英文值。未检测或检测失败时使用用户声明的能力快照并保留运行时错误可见性。

#### Scenario: Switch model before sending
- **WHEN** 用户在 composer 选择另一个已启用且验证可用的 Model Configuration 和 `high` 推理强度
- **THEN** 新 Turn 使用该配置，已有 Turn 和历史记录不被改写

#### Scenario: Selected model becomes unavailable before start
- **WHEN** Renderer 提交的 Model Configuration 已被停用、删除、重置为 unverified 或验证失败
- **THEN** Core 仅在配置已停用或删除时拒绝创建 Turn；unverified 或检测失败但仍启用的配置可以启动并在 Provider 调用失败时返回可操作的稳定错误

#### Scenario: Model configuration changes during a turn
- **WHEN** 一个 Turn 启动后用户修改或停用其 Model Configuration
- **THEN** 活动 Turn 继续使用启动时解析的不可变快照，后续 Turn 才使用新的目录状态

### Requirement: Conversation Reset and Cancellation
桌面端和 Core MUST 支持取消活动 Turn 与显式重置 Conversation；重置后新 Turn 不得携带旧历史，原始记录仍保留。

#### Scenario: Cancel a streaming turn
- **WHEN** 用户在模型流式输出或 Tool 执行等待期间点击取消
- **THEN** Runtime 中止后续模型调用、恢复输入控件并追加明确的 cancelled Timeline Item

## MODIFIED Requirements

### Requirement: Session-Bound Agent Task
每个 Agent Turn MUST 绑定一个 Session Conversation 和一个 Agent Model Selection，模型不得在 Tool 调用中改变目标 Session、本机用户根目录、Provider Profile 或 Model Configuration。

#### Scenario: Model supplies a session identifier
- **WHEN** 模型 Tool 参数包含未声明的 `sessionId`
- **THEN** Schema 校验拒绝调用且 ToolGateway 使用运行时绑定的 Session

### Requirement: Agent Concurrency Limits
Core MUST 限制每个 Session 最多一个活动 Agent Turn，并默认限制全局最多 4 个运行中的 Agent Turn。

#### Scenario: Start second turn in same session
- **WHEN** 一个 Session 已有活动 Turn 且用户再次提交消息
- **THEN** UI 禁止并发提交或 Core 拒绝新 Turn，且不得并行操作同一 Session

### Requirement: Explicit Context Disclosure
Agent MUST 仅在用户显式提交消息后调用 Provider，初始模型上下文不得自动包含终端屏幕或本机文件内容；这些内容只有对应 Tool 被调用后才可披露。

#### Scenario: Start a conversational turn
- **WHEN** 用户提交普通对话消息
- **THEN** Provider 收到对话历史和最小 Session 元数据，但不包含未调用 Tool 获得的终端屏幕或文件内容

### Requirement: Restricted Terminal Tools
Agent MUST 只能调用 `terminal_observe`、`terminal_execute`、`terminal_wait`、`terminal_interrupt`、`local_list_files`、`local_search_files`、`local_read_file`、`local_write_file` 和 `local_edit_file`，不得获得任意按键、Session 管理、文件删除、浏览器或插件 Tool。

#### Scenario: Model requests an unknown tool
- **WHEN** Provider 返回不在允许集合中的 Tool Call
- **THEN** AgentRuntime 拒绝执行、记录协议错误且不产生终端或文件副作用

### Requirement: Goal-Oriented Tool Loop
AgentRuntime MUST 根据用户消息、Conversation 历史和每个 Tool Result 迭代；从未使用 Tool 的 Turn 可在没有 Tool Call 时直接完成文本回复，已经使用 Tool 的 Turn 必须通过完成性复核后才能完成；有 Tool Call 时继续循环，直到复核确认完成、需要授权、需要用户接管、失败、达到限制或被取消。

#### Scenario: Multi-step diagnostic goal
- **WHEN** 用户要求诊断服务且模型先观察、再执行状态命令、再等待输出
- **THEN** Runtime 将每个 Tool Result 返回模型并在获得实际证据后输出最终结论

## REMOVED Requirements

### Requirement: POSIX Shell Probe
**Reason**: 无条件 POSIX 探测会污染 PowerShell，且新设计由当前 execution dialect 对应的 ShellDriver 在第一次执行前惰性探测。

**Migration**: 使用 `terminal-sessions` 中的 ShellDriver Capability Probe；现有 POSIX wrapper 迁移到 `PosixShellDriver`。
