## ADDED Requirements

### Requirement: Transport-Agnostic Terminal Session
系统 MUST 将 Terminal Session 建模为本地 PTY、终端状态、输入输出和历史，而不是 SSH、堡垒机、容器或服务器连接。

#### Scenario: User connects through a bastion
- **WHEN** 用户在终端内自行执行多跳 SSH 命令
- **THEN** Session 继续作为同一个本地 PTY 被管理且 Core 不解析连接拓扑

### Requirement: Core-Owned PTY
独立 Terminal Core MUST 持有所有 PTY、Session 状态和输出序列，Electron Renderer 或窗口生命周期不得拥有 PTY。

#### Scenario: Renderer crashes
- **WHEN** Electron Renderer 意外重载或崩溃
- **THEN** Core 中的 PTY 和 Session 保持运行并可由新 Renderer 重连

### Requirement: Orthogonal Session State
系统 SHALL 分别维护 PTY、UI attachment、Session Lease 和 Shell capability 状态，避免将无关状态压缩为单一枚举。

#### Scenario: Running session without UI
- **WHEN** PTY 正在运行而 UI 已分离
- **THEN** PTY 状态保持 `running` 且 attachment 状态为 `detached`

### Requirement: Exclusive Session Lease
任一时刻一个 Session MUST 只有一个输入控制者，且用户 SHALL 能随时撤销 Agent Lease。

#### Scenario: User emergency takeover
- **WHEN** 用户在 Agent 持有 Lease 时执行紧急接管
- **THEN** Lease epoch 增加、旧 Agent 写入令牌失效且后续输入归用户控制

#### Scenario: Stale Agent write
- **WHEN** Core 收到携带旧 Lease epoch 的 Agent 输入
- **THEN** 系统拒绝该输入并记录审计事件

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

