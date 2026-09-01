## ADDED Requirements

### Requirement: Terminal-Only Workspace
桌面工作区 MUST 只提供终端会话相关入口，MUST NOT 展示 Agent 面板、Composer、审批卡片、运行状态条、ACP 切换、MCP 共享入口或审计入口；Header MUST 只包含品牌、会话标签操作和设置入口。

#### Scenario: Workspace loads without agent surfaces
- **WHEN** 用户打开桌面工作区
- **THEN** 页面 MUST NOT 渲染 Agent 时间线、Composer、Agent 状态条、共享 Session ID 按钮或提示词历史入口

#### Scenario: Open settings from header
- **WHEN** 用户点击 Header 的“设置”按钮
- **THEN** 系统 MUST 进入单页 Settings Workspace 并保留返回工作区入口

### Requirement: Terminal Workspace
系统 MUST 提供桌面终端工作区，允许当前用户创建、查看、切换、重命名和关闭 Terminal Session 标签页。每个活动标签 MUST 显示 Session Alias、来自运行时摘要的终端类型和表示 PTY 可用性的状态点；新建标签入口和全部会话入口 MUST 始终可达。Session Alias 只是可读名称，不得替代唯一 `sessionId`。

#### Scenario: Create a terminal tab with a default alias
- **WHEN** 用户打开新建 Session 弹窗且当前活动 Session 使用了 `终端 1`、`终端 2` 等默认名称
- **THEN** 弹窗预填当前最小未占用的 `终端 N`，用户未填写或清空名称时创建请求 MUST 使用该默认名称

#### Scenario: Switch terminal tabs
- **WHEN** 用户在多个活动 Session 标签页之间切换
- **THEN** 系统显示所选 Session 的终端状态，且不改变其他 Session 的运行状态

#### Scenario: Navigate many terminal tabs
- **WHEN** 活动 Session 数量超过标签栏可见宽度或全部会话弹层可见高度
- **THEN** 用户 MUST 能通过单行横向滚动标签栏或搜索、滚动全部会话视图选择任一 Session，且 `+` 和全部会话操作不随标签列表滚动而消失

#### Scenario: Rename a terminal tab
- **WHEN** 用户通过标签上下文操作提交一个非空的新名称
- **THEN** 系统更新该 Session Alias 并广播更新后的 Session 摘要，且允许多个 Session 使用相同 Alias；其 `sessionId` MUST 保持不变

#### Scenario: Close a running terminal
- **WHEN** 用户关闭 PTY 仍在运行的 Session
- **THEN** UI MUST 在关闭前显示确认，并在确认后关闭目标 Session；取消确认不得影响目标 Session

#### Scenario: Session runtime state changes
- **WHEN** Main 广播某个活动 Session 的 PTY 状态或终端类型变化
- **THEN** 对应标签和全部会话视图 MUST 更新该 Session，且不得重建其他 Session 的终端状态

#### Scenario: Session status point reflects terminal availability
- **WHEN** Session 的 PTY 状态发生变化
- **THEN** 状态点 MUST 将运行中显示为绿色，将启动中显示为黄色，将失败显示为红色，将退出或中断显示为灰色

#### Scenario: Close all terminals
- **WHEN** 用户在「全部会话」面板点击“关闭全部终端”并确认
- **THEN** 全部 Session 被终止并从标签栏与全部会话列表移除，工作区回到空状态

#### Scenario: Context menu bulk close
- **WHEN** 用户右键标签页并选择“关闭当前”“关闭左侧所有”“关闭右侧所有”或“关闭所有”
- **THEN** 对应范围的 Session 被终止并从标签栏与全部会话列表移除

### Requirement: Header Context Controls
工作区 Header MUST 呈现 `Synapse Term` 品牌、按创建顺序排列的多 Session 标签、PTY 可用性状态点、全部会话入口、新建入口和设置按钮。Session 标签必须支持直接切换，标签列表在空间不足时横向滚动，`+` 和全部会话入口固定在标签列表右侧。Header MUST NOT 显示方言、资源监控、模型、权限或共享 ID 控件。

#### Scenario: Select a runtime session
- **WHEN** 用户从标签栏或全部会话菜单选择另一个 Session
- **THEN** Header 和 xterm MUST 切换到所选会话，且菜单关闭

#### Scenario: Enter the Settings Workspace
- **WHEN** 用户点击 Header 的“设置”按钮
- **THEN** 系统 MUST 进入 Settings Workspace 并显示占位内容，不显示旧的设置下拉菜单

### Requirement: Window Detach and Reconnect
关闭窗口 MUST 不终止仍由 Electron Main 持有的活动 Session。

#### Scenario: Close the desktop window
- **WHEN** 用户关闭窗口且仍存在活动 Session
- **THEN** UI 与 Main 分离且 Session 继续运行

#### Scenario: Reopen the desktop window
- **WHEN** 用户重新打开桌面窗口
- **THEN** UI 重新订阅每个活动 Session 的实时输出

### Requirement: Renderer Sandbox Isolation
Electron Renderer MUST 在 sandbox 与 context isolation 下运行，并且 SHALL 无法直接访问 PTY、Node.js 文件系统或 Session 内部状态。

#### Scenario: Renderer requests a terminal action
- **WHEN** Renderer 需要创建 Session、写入终端或订阅输出
- **THEN** 请求只能通过经过校验的 preload API 和 Electron Main 转发

### Requirement: Terminal Failure States
桌面端 MUST 明确展示 Session 创建失败、PTY 退出、输出中断和会话中断状态。

#### Scenario: PTY exits unexpectedly
- **WHEN** 某个 Session 的 PTY 进程退出
- **THEN** UI MUST 将 Session 标记为 `exited` 或 `interrupted`，且不得显示为仍连接

## MODIFIED Requirements

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
- **THEN** 系统 MUST 重新订阅该 Session 的实时输出并仅显示该 Session 的有序终端输出

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

### Requirement: Prototype Fonts and Desktop Scope
Renderer MUST 从本地资源加载 `Inter`、`Noto Sans SC` 与 `JetBrains Mono`，不得依赖网络字体；UI MUST 使用 `Inter, "Noto Sans SC", system-ui, sans-serif`，终端 MUST 使用 `"JetBrains Mono", monospace`。本变更不定义或验收移动端布局。

#### Scenario: Render offline with prototype font declarations
- **WHEN** Electron 在没有外网字体访问的情况下打开 Renderer
- **THEN** 页面 MUST 使用打包字体或准确字体回退，并保持两套基准视口的文字尺寸和布局契约

## REMOVED Requirements

### Requirement: Desktop Terminal Workspace
**Reason**: 旧需求包含共享 Session ID、Agent 状态与 Core 广播语义。
**Migration**: 见 ADDED Requirement: Terminal Workspace。

### Requirement: Session-Scoped Agent Panel
**Reason**: 内置 Agent 面板、时间线、Composer 与进度投影全部删除。
**Migration**: 未来重实现 Agent 时重新设计入口。

### Requirement: Approval and Takeover Controls
**Reason**: 审批与命令事务随 Agent/外部调用删除。
**Migration**: 未来重实现 Agent 时重新设计。

### Requirement: Agent Running Status Indicator
**Reason**: Agent 运行状态条随 Agent 删除。
**Migration**: 无替代。

### Requirement: Thinking and Startup Placeholder
**Reason**: Agent 推理占位与 ACP 启动提示随 Agent/ACP 删除。
**Migration**: 无替代。

### Requirement: Cancellation Remains Available During Agent Blocking States
**Reason**: Agent 阻塞状态与取消任务控件随 Agent 删除。
**Migration**: 无替代。

### Requirement: Prototype Context Controls
**Reason**: 旧需求包含方言、资源监控、模型、权限与共享 ID 控件。
**Migration**: 见 ADDED Requirement: Header Context Controls。

### Requirement: UI Detach and Reconnect
**Reason**: 旧需求引用 Core 重连语义。
**Migration**: 见 ADDED Requirement: Window Detach and Reconnect。

### Requirement: Renderer Isolation
**Reason**: 旧需求引用 Core Named Pipe 与 Agent 目标转发。
**Migration**: 见 ADDED Requirement: Renderer Sandbox Isolation。

### Requirement: Visible Failure States
**Reason**: 旧需求包含 Core 重启与 Provider 错误状态。
**Migration**: 见 ADDED Requirement: Terminal Failure States。
