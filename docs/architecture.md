# 架构说明

## 产品边界

Terminal Session 是一个由本机 Core 持有的 PTY、终端状态、输入输出序列和历史，不是 SSH Session 或服务器连接对象。用户可以在同一个 Session 中进入或退出 SSH、堡垒机、容器和 WSL；Core 不解析连接拓扑，也不保存远端主机或认证信息。

Agent Turn 始终绑定一个已经存在且 Ready 的 Session。模型不能创建、关闭、列举或切换 Session，Tool 参数中也没有 `sessionId`。多服务器支持由多个用户管理的 Terminal Session 自然实现。

## 进程架构

| 进程 | 主要职责 | 明确不持有 |
| --- | --- | --- |
| Electron Renderer | 中文工作区、xterm、Markdown 时间线、模型管理、审批和接管 UI | Node API、PTY、SQLite、Provider 密钥 |
| Electron Main | BrowserWindow、隔离 preload、Shell/home 动态发现、Core 启动和窄 IPC 转发 | Agent 策略、终端所有权、模型凭据 |
| Terminal Core | PTY、Session、AgentRuntime、Tool、Provider、策略、审计、SQLite、平台凭据存储 | 远程连接拓扑、桌面 DOM |

Main 与 Core 通过当前用户作用域的 Named Pipe 通信。握手包含协议版本、challenge、Core instance ID 和本地认证令牌；协议 major 不兼容时拒绝连接并在桌面显示明确错误，不会静默替换仍持有 Session 的 Core。

## Session 抽象

Session 由五个正交状态维度组成：

- PTY：`starting | running | exited | failed | interrupted`
- UI：`attached | detached`
- Lease：`user | agent(taskId) | none`
- Execution dialect：`posix | powershell | observe_only`
- Shell capability：`unknown | probing | ready | executing | interaction_required`

每个 Session 由一个 `SessionActor` 串行处理 PTY 输出、用户输入、Agent 输入、resize、Lease epoch 和进程退出。用户输入或接管会递增 capability/Lease epoch，使旧 Agent 写入令牌立即失效。默认最多 20 个活动 Session；每个 Session 最多一个活动 Turn；全局默认最多 4 个活动 Turn。

新建 Session 只需要名称和动态发现到的 Shell。Electron Main 使用当前操作系统用户的真实 home 作为 cwd；生产代码不写死用户、盘符、Git Bash、PowerShell、WSL 或系统组件绝对路径。

## ShellDriver 与命令事务

结构化命令执行由方言对应的 ShellDriver 完成：

- `PosixShellDriver` 使用安全引用、持久 Shell 状态和带 nonce 的私有 OSC 777 完成帧。
- `PowerShellDriver` 使用 UTF-16LE/Base64 分段传输、持久位置/变量状态和带 nonce 的私有完成事件。
- `observe_only` 允许终端观察，但拒绝结构化执行。

普通对话和 `terminal_observe` 不运行 Probe，也不取得输入 Lease。只有 `terminal_execute` 在实际写 PTY 前才惰性 Probe、申请 JIT Lease、执行本地策略并创建 Command Transaction。缺少匹配完成帧时，系统返回运行中、交互、Shell 丢失、超时或协议错误，不推断成功。

## Agent Runtime

每个 Session 默认有一个 `AgentConversation`；每条用户消息创建一个 `AgentTurn`。一个 Turn 可以包含多个 Model Run、assistant tool call、Tool Result 和最终文本。状态机支持运行、等待审批、等待用户、挂起、完成、失败和取消。

Runtime 流程：

```text
用户消息 -> 模型流
  -> 无 Tool Call：直接完成普通对话
  -> Tool Call：Schema -> 策略/审批 -> 执行 -> Tool Result
                 -> 追加结构化历史 -> 下一轮模型
```

模型一次返回多个 Tool Call 时按 Provider 顺序串行执行。等待审批、用户接管或副作用调用会阻塞后续调用，避免持久 Shell 和文件状态竞态。默认上限为 24 个 Model Run、40 个 Tool Call、连续 3 次相同无进展调用和 15 分钟活动时长。

`ContextBuilder` 生成版本化系统提示，初始上下文只包含规则、Conversation 历史、当前用户消息和最小 Session 元数据，不默认披露终端屏幕或本机文件。需要事实时模型必须显式调用 Tool。

## Context Budget 与压缩

Model Configuration 保存 Context Window、最大输出 Token、自动压缩开关和阈值。Core 为输出、Tool Result 和系统提示保留 headroom，并对结构化 Model Item 做 Token 估算。

达到阈值时，`ConversationCompactor` 将较早完整 Turn 转为持久摘要，后续请求使用“摘要 + 近期精确 Item”。Tool Call/Result 原子关系不会被拆开；原始 Model Item 不删除，UI 历史和审计仍可读取。

## Provider 与模型目录

`ProviderProfile` 只定义连接：协议、base URL、额外请求头、超时和平台凭据存储引用。`ModelConfiguration` 引用 Provider，定义模型 ID、上下文、能力、推理强度、启用/默认状态和检测结果，因此一个 Provider 可复用给多个模型。

`ProviderModelDiscoveryService` 通过 Core 内的官方 SDK 调用 Models API，处理分页、去重、500 条上限、总超时、取消和稳定错误映射。发现只帮助选择模型 ID；新配置仍是 disabled/unverified，必须通过 streaming 和指定 Tool Call 能力检测后才进入 Agent eligible list。

Provider Adapter 将统一结构映射到：

- OpenAI Responses function call / `function_call_output`
- OpenAI-compatible Chat Completions assistant `tool_calls` / role=`tool`
- Anthropic Messages `tool_use` / `tool_result`

## ToolGateway

Provider 可见 Tool 固定为四个 Terminal Tool 和五个 Local File Tool。Adapter 使用下划线名称，Core 内部由 `ToolGateway` 统一做 Zod Schema、Session 绑定、方言、路径、安全策略、审批、调用恢复和审计。

Local File Tool 的根目录由 `HomeResolver` 动态解析。`LocalFileService` 只接受 home 内相对路径，拒绝绝对路径、UNC、设备路径、ADS、NUL、`..`、symlink/junction/reparse point 逃逸；写入和编辑使用 expected SHA-256 与同目录原子替换。

## 资源快照

资源面板不是资产系统或监控服务。用户显式刷新时，`SessionResourceService` 检查 Session 空闲、方言和 Lease，通过当前 Session 执行固定只读采集命令，并解析主机、OS、uptime、CPU/负载、内存、交换分区、磁盘和网络。

POSIX 与 PowerShell 使用独立命令和解析器。部分指标缺失时保留已确认字段并标为不可用；活动命令、密码提示、TUI 或 `interaction_required` 状态下拒绝刷新。

## 输出、存储与生命周期

PTY 输出进入有界内存队列、`@xterm/headless` 和 `OutputJournal`，并按 Session 分配严格递增 sequence。UI 与 Agent 是独立消费者；历史被截断时返回终端快照和 `history_gap`，不会把缺失内容当作完整审计。

Core 数据默认位于 Electron `userData/core`，标准安装对应当前用户数据目录下的 `core` 子目录（Windows `%APPDATA%\Terminal Agent\core`；macOS `~/Library/Application Support/Terminal Agent/core`）：

- `core.sqlite`：Session 元数据、Conversation、Turn、Model Item、Tool Call、Command、Approval、Provider、Model Configuration 和结构化审计
- `raw-logs`：短期、有界原始终端输出
- `auth.token`：当前用户作用域 IPC 认证令牌
- `upgrade-state.ini`：安装器读取的 Core/Session/Agent 活动状态
- `backups`：迁移前 SQLite 备份和 SHA-256 清单

关闭 Renderer 不终止 PTY。显式退出 Core 会结束所有 Session；Core 崩溃、升级或系统重启后只恢复元数据、Conversation 和审计，旧 PTY 标记为 interrupted。

## 核心模块

| 模块 | 作用 |
| --- | --- |
| `SessionManager` / `SessionActor` | PTY 生命周期、串行事件、Lease 和方言 |
| `OutputJournal` / `TerminalModel` | 有界输出、快照、cursor 和 replay |
| `ShellDriver` / `CommandExecutor` | POSIX、PowerShell、完成协议和持续输出 |
| `AgentRuntime` / `AgentCoordinator` | 多轮循环、Conversation、审批恢复、时间线和调度 |
| `ContextBuilder` / `ConversationCompactor` | 显式披露、Token Budget 和自动压缩 |
| `ToolGateway` / `AuthorizationPolicy` | 九个 Tool、Schema、权限模式、风险与审批 |
| `LocalFileService` / `LocalFilePolicy` | home 边界、原子文件操作和敏感路径策略 |
| `ModelCatalogService` / Provider Adapters | Provider 1:N 模型、发现、检测和三协议映射 |
| `SessionResourceService` | 当前 Session 的显式只读资源快照 |
| `SqliteStore` / Repositories | schema v8、事务、迁移、备份和领域记录 |
| `CoreIpcServer` / `CoreSupervisor` | 认证 IPC、协议协商、重连和升级安全退出 |
