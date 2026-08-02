## ADDED Requirements

### Requirement: Current PTY Environment Identity
每个可执行 Session MUST 保存当前 PTY environment capability，而不是只保存启动 Shell。Capability 至少包含 `posix | powershell | unknown` dialect、`windows | unix | unknown` platform、验证状态、来源、时间和 capability epoch；启动配置只能作为未验证 hint。

#### Scenario: PowerShell enters a POSIX remote session
- **WHEN** 用户在 PowerShell Session 中人工执行 SSH 并进入 Linux/Unix 远端后请求 Agent 执行命令
- **THEN** Core 根据当前 PTY 的有界指纹把 environment dialect 更新为 `posix`，使用 POSIX 协议，并且不注入 PowerShell 代码或创建 SSH 拓扑对象

#### Scenario: POSIX enters a PowerShell session
- **WHEN** 用户在 POSIX Session 中人工进入 PowerShell 后请求 Agent 执行命令
- **THEN** Core 只在当前 epoch 验证到 PowerShell 后使用 PowerShell 协议，不信任原始 POSIX 启动 hint

#### Scenario: Environment fingerprint is ambiguous
- **WHEN** 当前 PTY 没有在 deadline 内返回唯一可解析的 dialect/platform 指纹
- **THEN** Core 将 environment 标记为 observation-only/未验证，并拒绝结构化 Agent 输入

### Requirement: Environment Verification Before Structured Input
Core MUST 在第一次 Agent 生成的结构化 Shell 输入前验证当前 PTY environment，并在 environment capability epoch 失效后于下一次结构化输入前重新验证；普通对话、观察和用户按键不得触发 Agent Probe。

#### Scenario: First structured command
- **WHEN** Session 刚启动且 Agent 首次请求 `terminal_execute` 或固定资源刷新
- **THEN** Core 先完成有界、无副作用的明文 environment/capability Probe，再决定是否允许结构化输入

#### Scenario: Conversation without execution
- **WHEN** 用户只进行普通 Agent 对话或调用终端观察
- **THEN** Core 不向 PTY 注入 dialect Probe、事务 wrapper 或其他 Agent 字节

### Requirement: Environment Epoch Invalidation
用户输入、User Takeover、PTY 重连、交互接管或检测到 Shell 进程边界变化时，Session MUST 使已验证 environment capability epoch 失效；旧 epoch 的 Agent 写入 MUST 被拒绝。

#### Scenario: User types an SSH hop
- **WHEN** 用户在 Agent 控制后人工输入 SSH、容器或嵌套 Shell 命令
- **THEN** Core 增加 capability epoch、清除 ready 状态，并要求下一次 Agent 结构化输入重新验证当前 PTY

#### Scenario: Stale environment write
- **WHEN** Agent 带着旧 environment epoch 请求写入事务
- **THEN** Core 在 PTY 写入前拒绝该请求并追加可关联的审计拒绝事件

### Requirement: Resource Refresh Uses Current Environment
Session Resource 刷新 MUST 使用同一套当前 environment verification 和明文 dispatch 边界，不得根据本地启动 Shell 或过期 dialect 选择资源命令。

#### Scenario: Refresh after remote transition
- **WHEN** 用户从 Windows PowerShell SSH 到 Linux 后请求刷新资源
- **THEN** Core 验证当前环境、使用 POSIX 资源命令并将快照标记为当前 epoch 的结果

## MODIFIED Requirements

### Requirement: Transport-Agnostic Terminal Session
系统 MUST 将 Terminal Session 建模为本地 PTY、终端状态、输入输出、当前 environment capability 和历史，而不是 SSH、堡垒机、容器或服务器连接；Core 不得把连接拓扑作为方言事实源。

#### Scenario: User connects through a bastion
- **WHEN** 用户在终端内自行执行多跳 SSH 命令
- **THEN** Session 继续作为同一个本地 PTY 被管理且 Core 不解析连接拓扑

#### Scenario: Current environment changes without a new Session
- **WHEN** 多跳命令使 PTY 内的 Shell 从启动方言切换为另一种受支持方言
- **THEN** Session 保持不变，但 environment capability 必须重新验证并反映当前 PTY

### Requirement: Orthogonal Session State
系统 SHALL 分别维护 PTY、UI attachment、Session Lease、当前 execution environment 和 Shell capability 状态，避免将无关状态压缩为单一枚举；未验证 environment 不得被表示为 ready。

#### Scenario: Running session without UI
- **WHEN** PTY 正在运行而 UI 已分离
- **THEN** PTY 状态保持 `running` 且 attachment 状态为 `detached`

#### Scenario: Running but unverified environment
- **WHEN** PTY 正在运行、用户可观察终端但当前 environment 尚未验证
- **THEN** Session 可以保持可观察状态，但 Agent 结构化执行状态为 observation-only
