## ADDED Requirements

### Requirement: Main-Owned PTY
Electron Main 进程 MUST 持有所有 PTY、Session 状态和输出序列，Electron Renderer 或窗口生命周期不得拥有 PTY。

#### Scenario: Renderer crashes
- **WHEN** Electron Renderer 意外重载或崩溃
- **THEN** Main 中的 PTY 和 Session 保持运行，新 Renderer 继续订阅实时输出

### Requirement: In-Memory Session Lifecycle
Session 状态 MUST 仅保存在应用运行期的内存中；应用退出后所有 Session 终止，MUST NOT 提供跨重启恢复、持久化历史或回放。

#### Scenario: Application restarts
- **WHEN** 用户退出并重新启动应用
- **THEN** 应用以无 Session 的全新状态启动，不显示或恢复旧 Session

### Requirement: Closed Session Removal
用户显式关闭 Session 后，该 Session MUST 从活动列表与全部会话视图中移除，MUST NOT 以 `exited` 状态继续展示；只有 PTY 自行退出且未被用户关闭的 Session MAY 以 `exited` 状态保留。

#### Scenario: Closed session disappears
- **WHEN** 用户关闭一个终端会话
- **THEN** 该 Session 从标签栏和全部会话列表中移除，且不显示“终端已退出”

### Requirement: Transport-Agnostic Local PTY Session
系统 MUST 将 Terminal Session 建模为本地 PTY、终端状态、输入输出和历史，而不是 SSH、堡垒机、容器或服务器连接；Electron Main MUST NOT 解析连接拓扑。

#### Scenario: User connects through a bastion
- **WHEN** 用户在终端内自行执行多跳 SSH 命令
- **THEN** Session 继续作为同一个本地 PTY 被管理且 Main 不解析连接拓扑

### Requirement: Minimal Session State
系统 SHALL 维护 PTY 状态与终端元数据，避免把无关状态压缩为单一枚举。

#### Scenario: Running session without UI
- **WHEN** PTY 正在运行而窗口尚未打开或 Renderer 已重载
- **THEN** PTY 状态保持 `running`，Session 继续由 Main 持有

### Requirement: Shell Environment Initialization
本地 PTY Session MUST 将桌面进程继承的环境与启动配置中的显式环境覆盖合并后传给 Shell，并由平台对应的 Shell 启动规则完成用户环境初始化。

#### Scenario: macOS GUI session discovers user commands
- **WHEN** 应用从 Finder 启动并创建 macOS Zsh 或 Bash Session，且用户在登录 Shell 配置中声明了额外 PATH 目录
- **THEN** Session 内的 Shell MUST 能发现该 PATH 目录中的可执行命令

#### Scenario: Windows desktop session inherits environment
- **WHEN** 应用从 Windows Explorer 启动并创建 Git Bash 或 PowerShell Session，且命令目录已经存在于桌面进程继承的用户环境或 Shell Profile 中
- **THEN** PTY MUST 接收该环境并能按对应 Shell 规则发现命令

## MODIFIED Requirements

### Requirement: Ordered Output Events
Electron Main MUST 为每个 Session 的 PTY 输出分配严格递增 sequence，并将同一有序事件用于实时订阅者。

#### Scenario: Multiple output consumers
- **WHEN** 多个 UI 订阅者同时消费输出
- **THEN** 每个消费者观察到相同顺序且慢消费者不阻塞 PTY ingestion

### Requirement: Bounded Ordered Terminal Output Frames
Electron Main MUST 在向 Renderer 广播前将任意大小的 PTY 输出拆成不超过 IPC 输出预算的 UTF-8 完整分片；每个分片 MUST 使用新的严格递增 sequence，且所有消费者 MUST 观察到与原始 PTY 输出相同的字节顺序。

#### Scenario: PTY emits output larger than one IPC frame
- **WHEN** 一个 Terminal Session 的 PTY 一次回调返回超过 IPC 单帧上限的输出
- **THEN** Main MUST 生成多个有序输出事件并广播多个有界输出帧，Renderer MUST 按 sequence 连续写入终端且不丢弃分片

#### Scenario: Output contains multibyte UTF-8 characters
- **WHEN** Main 在分片边界遇到多字节 UTF-8 字符
- **THEN** Main MUST NOT 拆开该字符或产生替换字符，拼接所有分片后 MUST 与原始输出字节等价

### Requirement: Session Detach Lifecycle
关闭窗口 MUST 只分离 UI，不终止活动 Session；显式退出应用 MUST 终止全部 Session。

#### Scenario: Window closed on macOS
- **WHEN** 用户关闭窗口且仍存在活动 Session，应用进程继续运行
- **THEN** UI 与 Main 分离且 Session 继续运行，重新打开窗口后继续订阅实时输出

#### Scenario: Explicit application quit
- **WHEN** 用户选择退出应用且存在活动 Session
- **THEN** Main 终止全部 Session 并释放全部 PTY

### Requirement: Multi-Session Resource Limits
Main MUST 支持默认最多 20 个活动 Session，并对 Session 数执行硬限制。

#### Scenario: Session limit reached
- **WHEN** 用户达到活动 Session 上限后请求新建 Session
- **THEN** Main 拒绝请求并返回可识别的资源限制错误

### Requirement: Resize Propagation
Electron Main MUST 将控制 UI 的终端行列变化应用到对应 PTY。

#### Scenario: Detached session resize
- **WHEN** Session 没有控制 UI attachment
- **THEN** Main 保留最后有效尺寸直到 UI 重连或配置改变

## REMOVED Requirements

### Requirement: Core-Owned PTY
**Reason**: 独立 Core 进程已删除，PTY 改由 Electron Main 持有。
**Migration**: 见 ADDED Requirement: Main-Owned PTY。

### Requirement: Transport-Agnostic Terminal Session
**Reason**: 旧需求包含 environment capability 语义，已随 Agent 结构化执行删除。
**Migration**: 见 ADDED Requirement: Transport-Agnostic Local PTY Session。

### Requirement: Orthogonal Session State
**Reason**: Lease、environment 与 Shell capability 状态已删除。
**Migration**: 见 ADDED Requirement: Minimal Session State。

### Requirement: Current PTY Environment Identity
**Reason**: 执行方言、环境验证和 capability epoch 全部随内置 Agent 与命令执行管线删除。
**Migration**: 新架构不提供 Agent 结构化执行，无需环境指纹。

### Requirement: Environment Verification Before Structured Input
**Reason**: 结构化 Shell 输入已删除，终端只接收用户直接输入。
**Migration**: 无替代；未来重实现 Agent 时重新设计。

### Requirement: Environment Epoch Invalidation
**Reason**: 与 Lease、审批和结构化写入一起删除。
**Migration**: 无替代；未来重实现 Agent 时重新设计。

### Requirement: Resource Refresh Uses Current Environment
**Reason**: 资源监控功能已删除。
**Migration**: 无替代；未来重实现时重新设计。

### Requirement: Exclusive Session Lease
**Reason**: 内置 Agent 与外部调用者已删除，不再存在多输入控制者。
**Migration**: 用户输入由 SessionActor 串行处理，不需要 Lease 语义。

### Requirement: Shared Session
**Reason**: MCP/ACP 外部调用已删除，Session 不需要对外寻址。
**Migration**: 未来重实现 MCP 时重新设计外部寻址。

### Requirement: Bounded Terminal Replay Pages
**Reason**: 终端回放功能已移除，不保留输出历史。
**Migration**: 无替代；Renderer 只订阅实时输出。

### Requirement: Replay and Snapshot Recovery
**Reason**: 终端回放功能已移除，不保留输出历史。
**Migration**: 无替代；Renderer 只订阅实时输出。

### Requirement: Core Restart Semantics
**Reason**: 独立 Core 进程已删除，Session 不再跨进程重启。
**Migration**: 应用退出即终止 Session，见 In-Memory Session Lifecycle。

### Requirement: Bounded Output Retention
**Reason**: 磁盘 raw-log 与审计保留已删除，且不提供回放历史。
**Migration**: 无替代；输出仅实时广播。

### Requirement: Platform-Safe Core IPC Endpoint
**Reason**: Named Pipe/Unix socket 跨进程通道已删除。
**Migration**: Renderer 通过 Electron ipcMain 与 Main 通信。

### Requirement: Close All Fault Isolation
**Reason**: Agent 关闭与 CoreRequestRouter 已删除。
**Migration**: Main 退出时统一终止 Session。

### Requirement: GUI Shell Environment Initialization
**Reason**: 旧需求包含 Agent Probe 与跨环境能力验证语义。
**Migration**: 见 ADDED Requirement: Shell Environment Initialization。
