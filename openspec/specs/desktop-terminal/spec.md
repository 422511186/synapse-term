# desktop-terminal Specification

## Purpose
规定 Windows 桌面终端工作区的 Session 创建与切换、基础终端交互、Session-scoped Agent 面板、审批与接管控件、UI 重连、Renderer 隔离和可见失败状态。
## Requirements
### Requirement: Desktop Terminal Workspace
系统 MUST 提供桌面终端工作区，允许当前用户创建、查看、切换、重命名和关闭 Terminal Session 标签页。每个活动标签 MUST 显示 Session Alias、来自运行时摘要的终端类型和表示终端可用性的状态点；新建标签入口、全部会话入口和共享当前 Session ID 入口 MUST 始终可达。Session Alias 只是可读名称，不得替代唯一 `sessionId`。

#### Scenario: Create a terminal tab with a default alias
- **WHEN** 用户打开新建 Session 弹窗且当前活动 Session 使用了 `终端 1`、`终端 2` 等默认名称
- **THEN** 弹窗预填当前最小未占用的 `终端 N`，用户未填写或清空名称时创建请求 MUST 使用该默认名称

#### Scenario: Switch terminal tabs
- **WHEN** 用户在多个活动 Session 标签页之间切换
- **THEN** 系统显示所选 Session 的终端状态和对应 Agent 状态，且不改变其他 Session 的运行状态

#### Scenario: Navigate many terminal tabs
- **WHEN** 活动 Session 数量超过标签栏可见宽度或全部会话弹层可见高度
- **THEN** 用户 MUST 能通过单行横向滚动标签栏或搜索、滚动全部会话视图选择任一 Session，且 `+`、全部会话和共享 ID 操作不随标签列表滚动而消失

#### Scenario: Rename a terminal tab
- **WHEN** 用户通过标签上下文操作提交一个非空的新名称
- **THEN** 系统持久化该 Session Alias、广播更新后的 Session 摘要，并允许多个 Session 使用相同 Alias；其 `sessionId` MUST 保持不变

#### Scenario: Close a running terminal
- **WHEN** 用户关闭 PTY 仍在运行或存在活动 Agent Task 的 Session
- **THEN** UI MUST 在关闭前显示确认，并在确认后关闭目标 Session；取消确认不得影响目标 Session

#### Scenario: Session runtime state changes
- **WHEN** Core 广播某个活动 Session 的 PTY、Shell、方言或终端类型变化
- **THEN** 对应标签和全部会话视图 MUST 更新该 Session，且不得重建其他 Session 的终端状态

#### Scenario: Session status point reflects terminal availability
- **WHEN** Session 状态发生变化
- **THEN** 状态点 MUST 将 Shell 就绪显示为绿色，将启动、探测、执行或等待交互显示为黄色，将失败显示为红色，将退出或中断显示为灰色；Agent 是否运行不得改变该状态点语义

#### Scenario: Share the current Session ID
- **WHEN** 用户点击标签栏右侧的共享 ID 操作
- **THEN** 系统 MUST 标记当前 Session 为 `Shared Session` 并复制唯一 `sessionId`；宽屏显示图标和“共享 ID”，窄屏可只显示图标但 MUST 提供完整 tooltip“共享并复制当前 Session ID”

### Requirement: Basic Terminal Interaction
桌面终端 MUST 支持人工输入、复制、粘贴、滚动、搜索和随窗口变化调整终端尺寸。

#### Scenario: Resize terminal
- **WHEN** 终端可视区域尺寸发生变化
- **THEN** 系统更新 xterm 渲染尺寸并向对应 PTY 发送新的行列数

#### Scenario: Search scrollback
- **WHEN** 用户在当前终端中搜索文本
- **THEN** 系统在可用滚动区中定位匹配结果且不向 PTY 写入内容

#### Scenario: Reopen an inactive terminal tab
- **WHEN** 用户选择此前未在 Renderer 中挂载的活动 Session 标签
- **THEN** 系统 MUST 调用该 Session 的 replay 接口并仅显示该 Session 的有序终端输出

### Requirement: Launch Profiles
系统 SHALL 支持由 executable、args、cwd、环境变量引用和初始尺寸组成的本地启动配置，且不得要求配置远程连接类型。受支持的本地 Shell 启动参数 MUST 遵循对应平台的用户环境初始化语义：macOS Zsh/Bash 与 Windows Git Bash MUST 以登录交互模式启动，Windows PowerShell MUST 不禁用用户 Profile，WSL MUST 保持发行版默认 Shell 的环境边界。

#### Scenario: Launch arbitrary local command
- **WHEN** 用户选择启动 `powershell.exe`、`wsl.exe` 或 `ssh.exe` 的配置
- **THEN** 系统按配置创建本地 PTY 且不创建 SSH、堡垒机或容器领域对象

#### Scenario: Launch a POSIX shell from the desktop
- **WHEN** 用户从 Finder、Explorer 或终端启动 macOS Zsh、macOS Bash 或 Windows Git Bash
- **THEN** 系统使用登录交互 Shell 参数创建 PTY，使用户登录初始化配置有机会设置 PATH 和其他用户环境

#### Scenario: Launch PowerShell with its user environment
- **WHEN** 用户从 Windows 桌面启动 PowerShell Session
- **THEN** 系统不得传入 `-NoProfile`，且 PowerShell 按默认规则加载可用的用户 Profile

#### Scenario: Launch WSL without crossing environment boundaries
- **WHEN** 用户从 Windows 桌面启动 WSL Session
- **THEN** 系统使用 WSL 默认用户 Shell 和发行版内部环境，不把 Windows 侧 CLI 路径作为 Linux PATH 的替代品

### Requirement: Session-Scoped Agent Panel
桌面端 MUST 呈现当前 Session 的固定 Agent 面板，但不得渲染额外的品牌标题栏、内置 Agent 就绪状态条或面板折叠块。面板 MUST 不再提供顶部 `Agent Timeline`/`审计日志 (Audit)` Tabs，也 MUST 不单独显示 plan、plan 槽位或 progress snapshot 卡片；面板内容直接包含运行状态、可滚动时间线和 Composer。审计日志 MUST 从设置进入并保持只读。当前桌面入口 MUST 只允许内置 Agent 发起新任务，ACP/外置 Agent 后端能力继续保留但不在该面板提供选择或启动入口。Timeline、审批和 Tool 数据仍来自 Agent history、timeline/delta 事件和安全 progress projection；progress snapshot 只保留在运行时/历史状态，不创建可见时间线节点。Assistant 文本 MUST 在流式期间以 delta 传输，并在终态或 history hydration 后收敛为一个完整稳定的 timeline item。

#### Scenario: Start an Agent Task
- **WHEN** 用户在已就绪 Session 的 Agent 面板提交自然语言目标
- **THEN** 系统创建绑定该 Session 的内置 Agent Task，并在 Agent 面板的滚动时间线中显示 Tool 和 Assistant 事件；progress snapshot 不单独生成可见卡片

#### Scenario: Change selected tab
- **WHEN** 用户切换到另一个 Session 标签页
- **THEN** 系统显示目标 Session 自己的 Agent 状态和历史，且不得隐式迁移原任务

#### Scenario: View audit from settings
- **WHEN** 用户从设置进入审计日志
- **THEN** 系统请求现有审计记录并以只读方式展示；Agent 面板不新增 Audit Tab，也不把审计行复制为 timeline item

#### Scenario: Run a multi-tool task
- **WHEN** Agent 依次调用 terminal 和本地文件 Tool
- **THEN** 面板在滚动时间线中按顺序显示各个 Tool 状态和基于 evidence 的最终结论，不创建 progress 或独立 plan 卡片

#### Scenario: User and Agent messages use role alignment
- **WHEN** 时间线收到用户消息或 Assistant 消息
- **THEN** 用户消息 MUST 右对齐、Assistant 消息 MUST 左对齐，双方 MUST 不渲染头像；Tool、审批和系统内容 MUST 使用全宽结构化卡片，progress snapshot 不创建可见节点

#### Scenario: Ask a simple question
- **WHEN** 用户发送普通对话且模型不调用 Tool
- **THEN** panel 应用有序 Assistant delta 到一个响应中，不得为每个 delta 渲染独立 timeline item，也不得重复最终文本

#### Scenario: Delta stream is interrupted
- **WHEN** Renderer 检测到缺失或乱序的 delta
- **THEN** Renderer 不得追加不可信片段，刷新 Agent history，并在可用时显示完整的持久化或终态 Assistant item

#### Scenario: External driver entry is hidden
- **WHEN** 用户打开桌面工作区或开始新任务
- **THEN** 面板 MUST 不显示标题栏、内置 Agent 就绪条、内置/外置 Agent 切换器、ACP 启动提示或外置 Agent 新任务入口；已有 ACP Core、preload 和后端进程能力 MUST 保持可编译和可被后续版本恢复

### Requirement: Approval and Takeover Controls
桌面端 MUST 提供命令批准、拒绝、命令中断和 User Takeover 的明确独立控件。任务取消 MUST 复用 Composer 的发送/停止按钮，不得在运行状态栏或 Composer 左侧再渲染第二个“取消任务”主按钮。Approval 卡片 MUST 以唯一 approval id 显示生命周期；完成、取消、过期、任务结束或环境失效后不得继续显示可操作的批准按钮。批准、拒绝、停止和中断按钮在请求处理期间 MUST 显示 pending 文案并忽略重复点击。

#### Scenario: Review a mutating command
- **WHEN** Agent 请求执行需要授权的命令
- **THEN** UI 显示完整命令、目标 Session、目的和风险，并允许用户批准或拒绝

#### Scenario: Approval completes or becomes stale
- **WHEN** Core 发出 approval completed、cancelled 或 invalidated 事件
- **THEN** UI 更新同一个 approval 卡片并隐藏批准/拒绝操作，不创建与 Tool 卡片重复的 actionable 卡片

#### Scenario: Resolved approval does not duplicate the tool card
- **WHEN** approval 已完成、取消或因环境失效，且对应 Tool 调用已经显示执行状态或结果
- **THEN** UI 保留 approval id 的状态合并能力，但不再渲染独立的终态 Approval 卡片；执行信息只通过 Tool 卡片展示

#### Scenario: Take over an interactive terminal
- **WHEN** Command Transaction 进入 `interaction_required`
- **THEN** UI 显示接管状态并允许用户获得输入控制权

#### Scenario: Approve or reject is in flight
- **WHEN** 用户点击"批准执行"或"拒绝执行"
- **THEN** 按钮 MUST 立即显示"批准中…/拒绝中…"并禁用，重复点击 MUST 被忽略，请求 settle 后恢复可点

#### Scenario: Stop task is in flight
- **WHEN** 用户在 Agent 运行期间点击 Composer 的停止按钮且取消请求尚未返回
- **THEN** Composer 停止按钮 MUST 显示加载状态和“取消中…”并禁用，重复点击 MUST 被忽略，且不得发起新的任务

### Requirement: Agent Running Status Indicator
Agent 面板 MUST 在任务运行期间、Composer 上方显示常驻运行状态条，包含“Agent 运行中”文案、当前模型名称和持续增长的已运行时长；状态条 MUST 不提供独立的取消主按钮，取消动作由 Composer 的停止按钮提供。状态条 MUST 由当前内置 Agent 的启动/活动状态派生，任务结束、失败或取消后 MUST 立即移除。状态条 MUST 不影响现有时间线、审批卡片与 Composer 的可用性。

#### Scenario: Show running status after submit
- **WHEN** 用户提交目标且任务开始运行
- **THEN** Composer 上方 MUST 显示运行状态条，展示当前模型与已运行时长，且 Composer 发送按钮切换为可用的停止按钮

#### Scenario: Cancel while a blocking state is active
- **WHEN** Agent 等待审批、环境 Probe、Provider 输出或 Tool Result
- **THEN** 运行状态条仍保持可见，Composer 停止按钮 MUST 可用并向当前 Session 的活动 Agent Task 发送取消请求

#### Scenario: Clear running status on completion
- **WHEN** Agent 任务完成、失败或用户取消
- **THEN** 状态条 MUST 移除或复位，Composer 恢复发送语义且不再显示运行中

### Requirement: Thinking and Startup Placeholder
时间线 MUST 在内置 Agent 任务运行中且自用户消息后尚未收到任何新事件时，显示“思考中…”占位动画；第一条工具、助手或系统事件到达后 MUST 自动移除占位。当前桌面入口不启动 ACP/外置 Agent，因此不得显示外置 Agent 的启动阶段提示。

#### Scenario: Thinking placeholder after submit
- **WHEN** 用户提交目标且内置模型正在推理、时间线暂无新事件
- **THEN** 时间线 MUST 在用户消息下方显示"思考中…"占位动画

#### Scenario: Placeholder removed on first event
- **WHEN** 第一条工具调用或助手事件到达
- **THEN** "思考中…"占位 MUST 自动移除

#### Scenario: External Agent startup is not exposed
- **WHEN** 用户在当前桌面版本打开 Agent 面板
- **THEN** UI MUST 不显示“正在启动外部 Agent”或“外部驱动者已就绪”等 ACP 专属阶段文案；ACP 后端状态不得改变内置 Agent 面板的启动文案

### Requirement: Cancellation Remains Available During Agent Blocking States
桌面端 MUST 在 Agent 等待审批、环境 Probe、Provider 输出或 Tool Result 时保持取消任务控件可用；显示可恢复错误时不得用全屏遮罩阻断取消操作，除非用户明确关闭该提示后继续。

#### Scenario: Cancel from approval waiting state
- **WHEN** Timeline 显示待审批卡片且用户点击取消任务
- **THEN** 请求发送到当前 Session 的活动 Agent Task，Core 返回 cancelled，UI 清除 active turn 和待审批操作

#### Scenario: Stale approval error is shown
- **WHEN** 用户点击旧审批导致 `approval_invalid` 或 `Approval is no longer pending`
- **THEN** UI 刷新当前 Agent 状态并将旧卡片置为不可操作，取消任务仍可点击且不会被错误弹层永久遮挡

### Requirement: Prototype Context Controls
工作区 Header MUST 呈现 `Synapse Term` 品牌、按创建顺序排列的多 Session 标签、终端可用性状态点、方言、资源监控、模型、权限和设置控件。Session 标签必须支持直接切换，标签列表在空间不足时横向滚动，`+`、全部会话和共享 ID 入口固定在标签列表右侧。除设置按钮外的 Header 下拉菜单 MUST 互斥打开；设置按钮 MUST 直接进入 Settings Workspace；审计入口属于设置工作区，不属于 Agent 面板 Tab。

#### Scenario: Select a runtime session
- **WHEN** 用户从标签栏或全部会话菜单选择另一个 Session
- **THEN** Header、xterm、资源、Agent 时间线和 Composer MUST 切换到所选会话，且菜单关闭

#### Scenario: Open an alternate context menu
- **WHEN** 一个 Header 下拉菜单已打开且用户点击另一个 Header 下拉控件
- **THEN** 系统 MUST 关闭旧菜单，只显示新菜单，位置和尺寸稳定且不遮挡标签固定操作

#### Scenario: Enter the Settings Workspace
- **WHEN** 用户点击 Header 的“设置”按钮
- **THEN** 系统 MUST 进入 Settings Workspace 并默认选中“服务商配置”，不得显示旧的全局设置下拉菜单

#### Scenario: Navigate to configuration topics
- **WHEN** 用户在 Settings Workspace 左侧选择服务商、模型、MCP、ACP 或审计主题
- **THEN** 系统 MUST 在右侧显示对应二级内容，且保留 `Synapse Term` Header 外观和返回工作区入口

### Requirement: Prototype Fonts and Desktop Scope
Renderer MUST 从本地资源加载 `Inter`、`Noto Sans SC` 与 `JetBrains Mono`，不得依赖网络字体；UI MUST 使用 `Inter, "Noto Sans SC", system-ui, sans-serif`，终端与 Audit MUST 使用 `"JetBrains Mono", monospace`。本变更不定义或验收移动端布局。

#### Scenario: Render offline with prototype font declarations
- **WHEN** Electron 在没有外网字体访问的情况下打开 Renderer
- **THEN** 页面 MUST 使用打包字体或准确字体回退，并保持两套基准视口的文字尺寸和布局契约

### Requirement: UI Detach and Reconnect
关闭或重启桌面 UI MUST 不终止仍由 Core 持有的活动 Session。

#### Scenario: Close the desktop window
- **WHEN** 用户关闭窗口且仍存在活动 Session
- **THEN** UI 与 Core 分离且 Session 继续运行

#### Scenario: Reopen the desktop
- **WHEN** 用户重新打开桌面端
- **THEN** UI 重新连接 Core 并通过增量或快照恢复每个活动 Session 的可见状态

### Requirement: Renderer Isolation
Electron Renderer MUST 在 sandbox 与 context isolation 下运行，并且 SHALL 无法直接访问 PTY、Node.js 文件系统、模型密钥或 Core Named Pipe。

#### Scenario: Renderer requests a Core action
- **WHEN** Renderer 需要创建 Session 或提交 Agent 目标
- **THEN** 请求只能通过经过 Schema 校验的 preload API 和 Electron Main 转发

### Requirement: Visible Failure States
桌面端 MUST 明确展示 Session 中断、Core 版本不兼容、Provider 错误、日志缺口和不确定命令状态。

#### Scenario: Core restarted
- **WHEN** UI 发现旧 Session 因 Core 重启而中断
- **THEN** UI 将 Session 标记为 `interrupted` 且不得显示为仍连接
