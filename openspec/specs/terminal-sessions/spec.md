# terminal-sessions Specification

## Purpose
规定与 SSH、堡垒机、容器等连接拓扑无关的本地 PTY Terminal Session 模型，包括 Core 所有权、正交状态、Lease、输出顺序、重放恢复、生命周期和资源上限。
## Requirements
### Requirement: Transport-Agnostic Terminal Session
系统 MUST 将 Terminal Session 建模为本地 PTY、终端状态、输入输出、当前 environment capability 和历史，而不是 SSH、堡垒机、容器或服务器连接；Core 不得把连接拓扑作为方言事实源。

#### Scenario: User connects through a bastion
- **WHEN** 用户在终端内自行执行多跳 SSH 命令
- **THEN** Session 继续作为同一个本地 PTY 被管理且 Core 不解析连接拓扑

#### Scenario: Current environment changes without a new Session
- **WHEN** 多跳命令使 PTY 内的 Shell 从启动方言切换为另一种受支持方言
- **THEN** Session 保持不变，但 environment capability 必须重新验证并反映当前 PTY

### Requirement: Core-Owned PTY
独立 Terminal Core MUST 持有所有 PTY、Session 状态和输出序列，Electron Renderer 或窗口生命周期不得拥有 PTY。

#### Scenario: Renderer crashes
- **WHEN** Electron Renderer 意外重载或崩溃
- **THEN** Core 中的 PTY 和 Session 保持运行并可由新 Renderer 重连

### Requirement: Orthogonal Session State
系统 SHALL 分别维护 PTY、UI attachment、Session Lease、当前 execution environment 和 Shell capability 状态，避免将无关状态压缩为单一枚举；未验证 environment 不得被表示为 ready。

#### Scenario: Running session without UI
- **WHEN** PTY 正在运行而 UI 已分离
- **THEN** PTY 状态保持 `running` 且 attachment 状态为 `detached`

#### Scenario: Running but unverified environment
- **WHEN** PTY 正在运行、用户可观察终端但当前 environment 尚未验证
- **THEN** Session 可以保持可观察状态，但 Agent 结构化执行状态为 observation-only

### Requirement: Current PTY Environment Identity
每个可执行 Session MUST 保存当前 PTY environment capability，而不是只保存启动 Shell。Capability 至少包含 `posix | powershell | unknown` dialect、`windows | unix | unknown` platform、`windows | linux | macos | unknown` operatingSystem、验证状态、来源、时间和 capability epoch；启动配置只能作为未验证 hint。

#### Scenario: PowerShell enters a POSIX remote session
- **WHEN** 用户在 PowerShell Session 中人工执行 SSH 并进入 Linux/Unix 远端后请求 Agent 执行命令
- **THEN** Core 根据当前 PTY 的有界指纹把 environment dialect 更新为 `posix`、operatingSystem 更新为实际识别结果，使用 POSIX 协议，并且不注入 PowerShell 代码或创建 SSH 拓扑对象

#### Scenario: POSIX enters a PowerShell session
- **WHEN** 用户在 POSIX Session 中人工进入 PowerShell 后请求 Agent 执行命令
- **THEN** Core 只在当前 epoch 验证到 PowerShell 和实际 operatingSystem 后使用 PowerShell 协议，不信任原始 POSIX 启动 hint

#### Scenario: Environment fingerprint is ambiguous
- **WHEN** 当前 PTY 没有在 deadline 内返回唯一可解析的 dialect、platform 或 operatingSystem 指纹
- **THEN** Core 将 environment 标记为 observation-only/未验证，并拒绝结构化 Agent 输入

### Requirement: Environment Verification Before Structured Input
Core MUST 在第一次 Agent 生成的模型请求或结构化 Shell 输入前验证当前 PTY environment，并在 environment capability epoch 失效后于下一次模型请求或结构化输入前重新验证；普通对话、观察和用户按键不得触发 Agent Probe。

#### Scenario: First structured Agent task
- **WHEN** Session 刚启动且用户提交需要终端证据的 Agent 目标
- **THEN** Core 先完成有界、无副作用的明文 environment/capability Probe，再把验证结果传给模型并决定是否允许结构化输入

#### Scenario: Conversation without execution
- **WHEN** 用户只进行普通 Agent 对话或调用终端观察
- **THEN** Core 不向 PTY 注入 dialect Probe、事务 wrapper 或其他 Agent 字节

### Requirement: Environment Epoch Invalidation
用户输入、User Takeover、PTY 重连、交互接管或检测到 Shell 进程边界变化时，Session MUST 使已验证 environment capability epoch 和绑定该 epoch 的 Pending Approval 失效；旧 epoch 的 Agent 写入 MUST 被拒绝。

#### Scenario: User types an SSH hop
- **WHEN** 用户在 Agent 控制后人工输入 SSH、容器或嵌套 Shell 命令
- **THEN** Core 增加 capability epoch、清除 ready 状态和旧审批，并要求下一次 Agent 结构化输入重新验证当前 PTY

#### Scenario: Stale environment write
- **WHEN** Agent 带着旧 environment epoch 请求写入事务或恢复旧审批
- **THEN** 系统在 PTY 写入前拒绝该请求并追加可关联的审计拒绝事件

### Requirement: Resource Refresh Uses Current Environment
Session Resource 刷新 MUST 使用同一套当前 environment verification 和明文 dispatch 边界，不得根据本地启动 Shell 或过期 dialect 选择资源命令。

#### Scenario: Refresh after remote transition
- **WHEN** 用户从 Windows PowerShell SSH 到 Linux 后请求刷新资源
- **THEN** Core 验证当前环境、使用 POSIX 资源命令并将快照标记为当前 epoch 的结果

### Requirement: Exclusive Session Lease
任一时刻一个 Session MUST 只有一个输入控制者（用户、内置 Agent 或外部调用者），用户 SHALL 能随时撤销非用户 Lease。

#### Scenario: User emergency takeover
- **WHEN** 用户在 Agent 持有 Lease 时执行紧急接管
- **THEN** Lease epoch 增加、旧 Agent 写入令牌失效且后续输入归用户控制

#### Scenario: Stale Agent write
- **WHEN** Core 收到携带旧 Lease epoch 的 Agent 输入
- **THEN** 系统拒绝该输入并记录审计事件

#### Scenario: External caller conflicts with user input
- **WHEN** 用户正在输入而外部调用者请求执行
- **THEN** 外部调用者 MUST 等待或失败，且不得抢占用户输入

### Requirement: Shared Session
Terminal Session MUST 只有在用户显式复制其 sessionId 并披露给外部调用者后才可被外部调用寻址（Shared Session）；复制动作 MUST NOT 改变 Session 状态、Lease 或安全边界。

#### Scenario: User copies session id
- **WHEN** 用户从桌面 UI 复制某个 Ready Session 的 id
- **THEN** 该 Session 成为 Shared Session，外部调用者可携带该 id 寻址，其余 Session 保持不可寻址

#### Scenario: Session never shared
- **WHEN** 用户未复制任何 id
- **THEN** 所有外部寻址调用都失败，且错误不泄露会话存在性

### Requirement: Ordered Output Events
Core MUST 为每个 Session 的 PTY 输出分配严格递增 sequence，并将同一有序事件用于日志、终端状态和订阅者。

#### Scenario: Multiple output consumers
- **WHEN** UI、Agent 和日志写入器同时消费输出
- **THEN** 每个消费者观察到相同顺序且慢消费者不阻塞 PTY ingestion

### Requirement: Replay and Snapshot Recovery
UI 重连时系统 MUST 根据最后确认 sequence 返回增量输出，或在历史缺失时返回终端快照和明确 `history_gap`。

#### Scenario: Incremental replay available
- **WHEN** UI 请求的 sequence 仍在 OutputJournal 中
- **THEN** Core 从下一 sequence 开始补发所有可用事件

#### Scenario: Requested history was truncated
- **WHEN** UI 请求的 sequence 早于最旧可用事件
- **THEN** Core 返回可重放快照、后续事件和 `history_gap` 标记

### Requirement: Session Detach Lifecycle
关闭窗口 MUST 只分离 UI，不终止活动 Session；最后一个 Session 结束后 Core MAY 按配置延迟退出。

#### Scenario: Explicit application quit
- **WHEN** 用户在存在活动 Session 时选择显式退出
- **THEN** 系统提供保持后台或终止全部 Session 的明确选择

### Requirement: Core Restart Semantics
MVP MUST 不声称 Session 能跨 Core 崩溃、Core 升级或 Windows 重启存活。

#### Scenario: Core process terminates
- **WHEN** 持有 ConPTY 的 Core 进程终止
- **THEN** 重启后的 Core 恢复元数据与审计并把旧 Session 标记为 `interrupted`

### Requirement: Multi-Session Resource Limits
Core MUST 支持默认最多 20 个活动 Session，并 SHALL 对 Session 数、滚动区、日志和订阅队列执行可配置硬限制。

#### Scenario: Session limit reached
- **WHEN** 用户在达到活动 Session 上限后请求新建 Session
- **THEN** Core 拒绝请求并返回可识别的资源限制错误

### Requirement: Bounded Output Retention
系统 MUST 分层保留输出：活动 Session 的有界原始日志用于重连，Session 结束后短期清理，长期仅保存结构化审计。

#### Scenario: Raw journal expires
- **WHEN** 已结束 Session 的原始日志超过配置保留期
- **THEN** 清理任务删除原始日志且保留仍在期限内的结构化审计

### Requirement: Resize Propagation
Core MUST 将控制 UI 的终端行列变化应用到对应 PTY 和 headless terminal。

#### Scenario: Detached session resize
- **WHEN** Session 没有控制 UI attachment
- **THEN** Core 保留最后有效尺寸直到 UI 重连或配置改变

### Requirement: Platform-Safe Core IPC Endpoint
Core 与 Desktop Main MUST 为同一 appId 和当前 OS 用户推导相同的本地 IPC endpoint。POSIX Unix-domain socket 路径 MUST 在 UTF-8 字节长度上低于 Darwin 支持上限，并在用户临时目录过长时使用确定的短路径回退；Windows Named Pipe 格式 MUST 保持兼容。

#### Scenario: Long macOS temporary directory
- **WHEN** macOS 用户临时目录与 appId 组合会生成超长 socket 路径
- **THEN** Core 与 Desktop Main MUST 得到相同、可绑定且不超过安全字节上限的短 Unix socket 路径

#### Scenario: Existing Windows endpoint
- **WHEN** 系统运行在 Windows
- **THEN** endpoint MUST 保持当前用户范围的 `\\\\.\\pipe\\` Named Pipe 格式

#### Scenario: Distinct user scopes
- **WHEN** 两个不同 OS 用户启动同一 appId 的 Core
- **THEN** 两者 MUST 得到不同的 endpoint，且不得共享认证 token

### Requirement: GUI Shell Environment Initialization
本地 PTY Session MUST 将桌面进程继承的环境与启动配置中的显式环境覆盖合并后传给 Shell，并由平台对应的 Shell 启动规则完成用户环境初始化。Session MUST 保留现有当前 PTY environment capability 验证作为 Agent 结构化执行前的最终事实源。

#### Scenario: macOS GUI session discovers user commands
- **WHEN** 应用从 Finder 启动并创建 macOS Zsh 或 Bash Session，且用户在登录 Shell 配置中声明了额外 PATH 目录
- **THEN** Session 内的 Shell MUST 能发现该 PATH 目录中的可执行命令，且 Agent Probe 依据当前 PTY 返回的 capability 决定是否允许结构化执行

#### Scenario: Windows desktop session inherits environment
- **WHEN** 应用从 Windows Explorer 启动并创建 Git Bash 或 PowerShell Session，且命令目录已经存在于桌面进程继承的用户环境或 Shell Profile 中
- **THEN** PTY MUST 接收该环境并能按对应 Shell 规则发现命令，不得因空的 Session 环境覆盖而丢失继承变量

#### Scenario: WSL keeps distro-local command discovery
- **WHEN** 应用创建 WSL Session 且 `codex` 只安装在 Windows PATH 或只安装在 WSL 发行版 PATH
- **THEN** 系统 MUST 只在实际运行环境包含该命令时报告发现成功，不得把另一侧环境的 PATH 当作成功依据

#### Scenario: Environment changes after application launch
- **WHEN** 用户在应用启动后修改系统或用户 PATH
- **THEN** 新建 Session MUST 使用应用当前可获得的环境；已存在的 PTY 不得被静默重写，用户需要重启应用或重新建立 Session 才能获得新的桌面环境

### Requirement: Close All Fault Isolation
CoreRequestRouter 的 `closeAll` 关闭流程 MUST 容错隔离 agent 关闭与 session 关闭：agent 关闭抛错时 MUST 记录但不阻断后续 session PTY 关闭，MUST NOT 因 agent 关闭失败而跳过全部 session 关闭与 `#onActivityChange` 通知。

#### Scenario: Agent close fails during shutdown
- **WHEN** `closeAllIfConfigured()` 在关闭 agent 时抛错
- **THEN** Router MUST 捕获并记录该错误，继续执行 session PTY 关闭循环，最终仍触发 `#onActivityChange`

