## ADDED Requirements

### Requirement: Session-Bound Agent Task
每个 Agent Task MUST 绑定一个 Ready Session 和一个 Provider Profile，模型不得在 Tool 调用中改变目标 Session。

#### Scenario: Model supplies a session identifier
- **WHEN** 模型 Tool 参数包含未声明的 `sessionId`
- **THEN** Schema 校验拒绝调用且 ToolGateway 使用运行时绑定的 Session

### Requirement: Agent Concurrency Limits
Core MUST 限制每个 Session 最多一个活动 Agent Task，并默认限制全局最多 4 个运行中的 Agent Task。

#### Scenario: Start second task in same session
- **WHEN** 一个 Session 已有活动 Agent Task 且用户请求启动另一个
- **THEN** Core 拒绝新任务或要求先结束现有任务

### Requirement: Explicit Context Disclosure
Agent MUST 仅在用户显式唤起后获得当前屏幕、有限回滚记录和本 Task 历史。

#### Scenario: Session is idle without Agent
- **WHEN** 用户没有启动 Agent Task
- **THEN** Core 不向任何模型 Provider 持续发送终端输出

### Requirement: Restricted Terminal Tools
MVP Agent MUST 只能调用 `terminal.observe`、`terminal.execute`、`terminal.wait` 和 `terminal.interrupt`，不得获得任意按键、本机文件、浏览器或插件 Tool。

#### Scenario: Model requests an unknown tool
- **WHEN** Provider 返回不在允许集合中的 Tool Call
- **THEN** AgentRuntime 拒绝执行并记录协议错误

### Requirement: POSIX Shell Probe
结构化执行前系统 MUST 探测当前 Shell 是否支持所需 POSIX 能力，并在人工输入或 User Takeover 后使旧 capability epoch 失效。

#### Scenario: Probe succeeds
- **WHEN** Shell 正确响应 `printf`、`eval` 和私有 OSC 探测
- **THEN** Session Shell 状态变为 `ready` 并允许受控命令执行

#### Scenario: Probe fails
- **WHEN** 当前 Shell 不支持协议或返回无法识别的响应
- **THEN** Agent 保持 observation-only 且不得执行结构化命令

### Requirement: Command Transaction Completion
`terminal.execute` MUST 为命令创建唯一 Command Transaction，并且只有匹配 nonce 的完成事件才能提供确定退出码。

#### Scenario: Command completes normally
- **WHEN** Core 收到匹配 transaction nonce 的 OSC 完成事件
- **THEN** Transaction 标记 `completed` 并返回捕获的退出码

#### Scenario: Completion event is missing
- **WHEN** Shell 返回 prompt、退出或断连但没有匹配完成事件
- **THEN** Transaction 标记为交互、Shell 丢失或协议错误，且不得声明成功

### Requirement: Persistent Shell State
命令协议 SHALL 保持 `cd`、`export` 等在当前 Shell 中产生的状态变化，而不是默认在隔离子 Shell 中执行。

#### Scenario: Change working directory
- **WHEN** Agent 执行已授权的 `cd` 命令并成功完成
- **THEN** 后续命令在新的工作目录中执行

### Requirement: Continuous Output Observation
PTY 输出 MUST 实时显示给用户，Agent Tool Result SHALL 按完成、交互、错误或 observation window 分批返回。

#### Scenario: Long-running command remains active
- **WHEN** 命令超过 observation window 但仍在运行
- **THEN** `terminal.execute` 返回 `running`、当前输出和 cursor，且 Agent 可调用 `terminal.wait`

### Requirement: Bounded Agent Output
发送给模型的命令输出 MUST 有大小上限，并在截断时返回总长度、首尾片段和可继续读取的 cursor。

#### Scenario: Command produces large output
- **WHEN** 命令输出超过单次 Tool Result 上限
- **THEN** Agent 收到明确的截断元数据且原始输出继续保留在本机有界日志中

### Requirement: Interaction Handoff
检测到密码、确认、pager、editor、alternate screen 或复杂交互时，Agent MUST 停止输入并将 Session Lease 交给用户。

#### Scenario: Sudo asks for a password
- **WHEN** 命令进入密码输入状态
- **THEN** Transaction 进入 `interaction_required`、Agent 停止输入且 UI 提示 User Takeover

#### Scenario: User returns control
- **WHEN** 用户完成交互并请求恢复 Agent
- **THEN** Core 重新执行 ShellProbe 后才允许下一条 Agent 命令

### Requirement: Separate Cancellation and Interrupt
取消 Agent Task MUST 不自动向正在运行的命令发送 Ctrl+C；命令中断必须是独立、可审计的动作。

#### Scenario: User cancels reasoning
- **WHEN** 用户取消 Agent Task 而命令仍在运行
- **THEN** Agent 不再进行模型推理且命令继续运行，除非用户另行请求中断

### Requirement: UI Disconnect Suspension
UI 断开时当前 Command Transaction SHALL 继续到自然结束，之后 Agent Task MUST 进入 `suspended`。

#### Scenario: Window closes during a command
- **WHEN** UI 在 Agent 命令运行期间断开
- **THEN** Core 不启动新的模型轮次或命令，并在当前命令结束后暂停 Task

### Requirement: Goal-Oriented Tool Loop
AgentRuntime MUST 根据自然语言目标、观察结果和 Tool Result 迭代，直到给出结果、需要授权、需要用户接管、失败或被取消。

#### Scenario: Read-only diagnostic goal
- **WHEN** 用户要求查看某服务状态且所需命令均被判定为只读
- **THEN** Agent 可连续执行受控命令并基于实际输出返回结论

### Requirement: Internal Tool Integration
内置 Agent SHALL 直接使用强类型 ToolGateway，不得通过 MCP 承载内部高频 PTY 控制流。

#### Scenario: Execute built-in Agent tool
- **WHEN** AgentRuntime 接受一个合法 Tool Call
- **THEN** ToolGateway 在同一 Core 内执行策略和 Session 操作而不经过外部 MCP Server

