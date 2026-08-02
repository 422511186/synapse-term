## MODIFIED Requirements

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
