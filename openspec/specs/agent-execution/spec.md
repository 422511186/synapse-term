# agent-execution Specification

## Purpose
规定本地 Agent 如何绑定一个 Ready Session、使用受限 Terminal Tools、执行具有确定完成证据的命令事务，并在持续输出、交互接管、取消和 UI 断连场景中安全推进自然语言目标。
## Requirements
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

### Requirement: Plaintext Shell Transaction Transport
所有 Agent 生成的命令事务、Shell capability Probe 和固定资源脚本 MUST 以目标 Shell 可直接阅读的明文源写入 PTY；原始命令、事务边界、退出码和 nonce 完成标记 MUST 在服务器执行前可从 PTY 输入重组。系统 MUST NOT 把编码、压缩或其他不透明载荷解码后作为代码执行。

#### Scenario: POSIX command is dispatched
- **WHEN** Agent 请求执行一个有效 POSIX 命令
- **THEN** Fake PTY 和服务器输入审计都能看到该命令及明文事务边界，且写入内容不包含 Base64 解码后动态执行路径

#### Scenario: PowerShell command is dispatched
- **WHEN** Agent 请求执行 PowerShell 命令
- **THEN** PTY 输入包含可读的 PowerShell 当前作用域事务块，不包含 `FromBase64String`、`EncodedCommand` 或动态创建 ScriptBlock 的编码载荷

#### Scenario: Encoded execution path is detected
- **WHEN** dispatch 构造器或静态检查发现编码数据将流入动态 Shell 执行
- **THEN** Core 在写入 PTY 前返回 `command_not_auditable` 并不执行该命令

### Requirement: Cross-Dialect Environment Probe
结构化执行 MUST 先使用固定明文环境指纹确定当前 PTY 的 dialect，再只使用该 dialect 的明文 capability Probe；Core 不得为了猜测方言而依次注入多套 Shell 语法。

#### Scenario: Local hint disagrees with SSH target
- **WHEN** Session 启动 hint 为 PowerShell 但当前 PTY 已进入 POSIX 远端
- **THEN** Core 先完成有界指纹，选择 POSIX Probe 和 POSIX transaction driver，且不向远端写入 PowerShell wrapper

#### Scenario: Fingerprint times out
- **WHEN** 固定指纹或方言 Probe 在 deadline 内没有唯一成功完成事件
- **THEN** Agent Task 得到可恢复的环境未验证错误，Session 保持 observation-only，且不继续发送命令

### Requirement: Bounded Plaintext PTY Transport
明文 PTY writer MUST 以有界块传输原始源文本，不得在块边界插入编码字符或改变 Unicode；只有源代码中的行结束符可以映射为目标 PTY 的提交回车，并且不得因单行长度而截断或改写命令。

#### Scenario: Long Unicode command
- **WHEN** 命令包含超过单次 PTY 安全大小的单行或 Unicode 字符
- **THEN** Core 分成多个有界明文写入，重组后的源文本与 Tool 参数语义等价且不拆分字符

#### Scenario: Command contains multiple lines
- **WHEN** Agent 请求多行 POSIX 或 PowerShell 脚本
- **THEN** writer 保留行顺序和内容，事务块在目标 Shell 中一次完成解析，不把中间行提前作为独立命令提交

### Requirement: Auditable Single-Line Transaction Envelope
当原始命令是可安全内联的单行文本时，Core MUST 将明文事务边界、原始命令、退出码采集和完成标记作为一个物理 PTY 输入行提交；该行 MUST 直接包含原始命令，且不得包含编码后动态执行。Core MUST NOT 为了压成一行而改写包含物理换行、注释或续行语义的用户命令。

#### Scenario: Single-line POSIX command
- **WHEN** Agent 执行单行 POSIX 命令 `df -h`
- **THEN** Fake PTY 捕获一条包含 `df -h`、明文开始/完成边界和 nonce 的物理输入行

#### Scenario: Multi-line command remains structured
- **WHEN** Agent 请求带物理换行或行尾注释的 Shell 源文本
- **THEN** Core 保留原始行结构而不是以分号、`eval`、`sh -c` 或编码载荷重新解释文本

### Requirement: Bounded Fixed Resource Collection
Session Resource 刷新 MUST 使用一组固定、短小、只读的明文事务，而不是向交互 PTY 发送超过项目物理行安全上限的巨型资源脚本。每个事务 MUST 经过统一 dispatch，并在同一 Lease 和已验证 environment epoch 内顺序执行和合并输出。

#### Scenario: POSIX resource refresh
- **WHEN** 已验证的 POSIX Session 请求资源刷新
- **THEN** Core 发送多个受控长度的明文资源命令，所有捕获行均可审计，且不会发送单条超过安全上限的资源 payload

#### Scenario: Partial resource availability
- **WHEN** 某个固定资源命令在已验证环境中不可用或返回非零结果
- **THEN** Core 汇总其余命令的协议输出并返回 partial 或 unavailable 资源快照，不得回退到编码执行或超长脚本

### Requirement: Unified Agent PTY Dispatch
`terminal_execute`、Shell Probe、Session Resource 刷新和未来 Core 生成的 Shell 操作 MUST 经过同一个受控 dispatch；调用者 MUST 提供当前 Lease epoch、environment capability epoch、dialect 和 source kind，不能直接向 PTY 写入任意 Agent 字节。

#### Scenario: Resource refresh dispatch
- **WHEN** 用户请求刷新 Session 资源
- **THEN** 资源服务使用与 `terminal_execute` 相同的 environment、明文 transport、Lease 和审计校验，不绕过 Command/Probe dispatch

#### Scenario: Direct Agent PTY write attempt
- **WHEN** 新的 Core 模块尝试绕过 dispatch 调用低层 Agent PTY write API
- **THEN** 类型、模块边界或运行时 capability 校验拒绝调用，并产生安全审计

### Requirement: Non-Auditable Execution Rejection
无法识别当前 environment、无法构造语义等价的明文事务、Lease/epoch 失效或完成协议不可验证时，Agent MUST fail closed；系统不得回退旧编码 wrapper、猜测 Shell 或声明命令成功。

#### Scenario: Plaintext envelope cannot be built
- **WHEN** 命令包含无法安全传输的控制字符、边界冲突或不支持的 Shell 结构
- **THEN** Tool 返回 `command_not_auditable`，PTY 不接收该事务，Session 仍可被用户观察或接管

#### Scenario: Completion evidence is missing
- **WHEN** 明文事务已写入但没有匹配 nonce 的完成事件
- **THEN** Transaction 进入 `protocol_error`、`shell_lost` 或交互状态，不得返回 `completed`

### Requirement: Command Transaction Completion
`terminal.execute` MUST 为命令创建唯一 Command Transaction，并且只有匹配 nonce 的明文完成事件才能提供确定退出码；服务器可见的事务源文本必须与被批准的原始命令保持一致。

#### Scenario: Command completes normally
- **WHEN** Core 收到匹配 transaction nonce 的 OSC 完成事件
- **THEN** Transaction 标记 `completed` 并返回捕获的退出码

#### Scenario: Completion event is missing
- **WHEN** Shell 返回 prompt、退出或断连但没有匹配完成事件
- **THEN** Transaction 标记为交互、Shell 丢失或协议错误，且不得声明成功

#### Scenario: Wrapper changes the approved command
- **WHEN** dispatch 构造的 PTY source 与审批时的完整命令文本不一致
- **THEN** Core 在写入前使 Approval Grant 失效并拒绝执行

### Requirement: Persistent Shell State
命令协议 SHALL 在当前已验证 Shell 作用域中保持 `cd`、`export`、变量和受支持函数等状态变化，而不是默认在隔离子 Shell 或隐藏临时脚本中执行；明文事务外围不得覆盖用户命令的成功/失败语义而伪造完成。

#### Scenario: Change working directory
- **WHEN** Agent 执行已授权的 `cd` 命令并成功完成
- **THEN** 后续命令在新的工作目录中执行

#### Scenario: Preserve PowerShell state
- **WHEN** Agent 执行设置变量或 `Set-Location` 的 PowerShell 命令并成功完成
- **THEN** 后续 Transaction 在同一 PowerShell Session 观察到该状态且完成事件仍匹配 nonce

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
- **THEN** 取消信号终止后续处理，晚到的模型/Probe 结果不得重新建立活动 Agent Task
