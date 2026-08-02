## ADDED Requirements

### Requirement: Session Execution Dialect
每个 Session MUST 保存 `posix`、`powershell` 或 `observe_only` execution dialect，默认值由本地启动 Shell 决定。用户人工输入使 capability epoch 失效后，Core MUST 在下一次结构化执行前使用有界、无副作用的方言指纹自动确认当前环境；用户仍 SHALL 能显式调整。

#### Scenario: PowerShell connects to Linux through SSH
- **WHEN** 用户在 PowerShell Session 内人工执行 `ssh` 进入 POSIX 远端后请求 Agent 执行命令
- **THEN** Core 在完整 Probe 前识别当前环境为 POSIX、同步 Session 方言并使用 PosixShellDriver，且不创建 SSH 连接对象或注入 PowerShell 包装代码

### Requirement: ShellDriver Capability Probe
Core MUST 只在第一次结构化命令执行或 capability epoch 失效后的下一次执行前，使用当前 execution dialect 对应的 ShellDriver 运行惰性 Probe。

#### Scenario: Chat in PowerShell
- **WHEN** 用户在 PowerShell Session 中进行普通 Agent 对话而没有调用 `terminal_execute`
- **THEN** Core 不向 PTY 写入 POSIX 或 PowerShell Probe

#### Scenario: Execute in PowerShell
- **WHEN** 当前 execution dialect 为 `powershell` 且 Agent 请求执行命令
- **THEN** Core 只使用 PowerShellDriver Probe 和命令包装，不发送 `eval`、`printf` 或 `unset`

### Requirement: PowerShell Command Transaction
PowerShellDriver MUST 在当前 PowerShell Session 中执行命令、保持位置与变量状态，并通过匹配 nonce 的私有完成事件返回确定退出状态。

#### Scenario: Preserve PowerShell location
- **WHEN** Agent 成功执行 `Set-Location` 后再执行读取当前位置的命令
- **THEN** 第二条命令观察到更新后的当前目录且每条 Transaction 有确定完成证据

### Requirement: Dynamic Local Runtime Paths
生产代码 MUST 从操作系统、环境、注册表或可注入解析器动态取得用户主目录和本地 Shell 路径，不得写死用户名、盘符或固定安装绝对路径。

#### Scenario: Git is installed outside the default drive
- **WHEN** Git for Windows 注册表或 PATH 指向非默认位置
- **THEN** Shell locator 返回该真实 `bash.exe` 路径并可创建 Session

#### Scenario: Resolve current user home
- **WHEN** 应用由任意 Windows 用户启动
- **THEN** Core 和桌面端使用该用户的动态 home 作为文件边界和默认 cwd，不引用开发者路径

### Requirement: Default Home Launch
桌面标准创建流程 MUST 使用 Electron Main 动态提供的当前用户 home 作为 Session cwd，Renderer SHALL 不要求用户提供 working directory。

#### Scenario: Start a new local shell
- **WHEN** 用户只选择名称和 Shell 创建 Session
- **THEN** PTY 在当前用户 home 启动，用户可随后自行运行 `cd`、`ssh`、容器或堡垒机命令

## MODIFIED Requirements

### Requirement: Orthogonal Session State
系统 SHALL 分别维护 PTY、UI attachment、Session Lease、execution dialect 和 Shell capability 状态，避免将无关状态压缩为单一枚举。

#### Scenario: Running observation-only session
- **WHEN** PTY 正在运行、UI 已连接且 execution dialect 为 `observe_only`
- **THEN** 用户可人工输入且 Agent 可观察，但结构化命令执行被拒绝

### Requirement: Exclusive Session Lease
任一时刻一个 Session MUST 只有一个输入控制者，用户 SHALL 能随时撤销 Agent Lease；普通对话、终端观察和本机文件 Tool 不得获取输入 Lease。

#### Scenario: User emergency takeover
- **WHEN** 用户在 Agent 执行命令时执行紧急接管
- **THEN** Lease epoch 增加、旧 Agent 写入令牌失效且后续输入归用户控制

#### Scenario: Observe while user controls input
- **WHEN** Agent 调用 `terminal_observe`
- **THEN** Tool 返回有界终端状态且用户 Lease 保持不变
