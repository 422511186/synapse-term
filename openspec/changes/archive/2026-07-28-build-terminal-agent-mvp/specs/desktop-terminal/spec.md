## ADDED Requirements

### Requirement: Desktop Terminal Workspace
系统 MUST 提供 Windows 桌面终端工作区，允许当前用户创建、查看、切换和关闭 Terminal Session 标签页。

#### Scenario: Create a terminal tab
- **WHEN** 用户选择一个有效的启动配置创建终端
- **THEN** 系统创建新的 Session 标签页并显示其实时终端内容

#### Scenario: Switch terminal tabs
- **WHEN** 用户在多个活动 Session 标签页之间切换
- **THEN** 系统显示所选 Session 的终端状态且不改变其他 Session 的运行状态

### Requirement: Basic Terminal Interaction
桌面终端 MUST 支持人工输入、复制、粘贴、滚动、搜索和随窗口变化调整终端尺寸。

#### Scenario: Resize terminal
- **WHEN** 终端可视区域尺寸发生变化
- **THEN** 系统更新 xterm 渲染尺寸并向对应 PTY 发送新的行列数

#### Scenario: Search scrollback
- **WHEN** 用户在当前终端中搜索文本
- **THEN** 系统在可用滚动区中定位匹配结果且不向 PTY 写入内容

### Requirement: Launch Profiles
系统 SHALL 支持由 executable、args、cwd、环境变量引用和初始尺寸组成的本地启动配置，且不得要求配置远程连接类型。

#### Scenario: Launch arbitrary local command
- **WHEN** 用户选择启动 `powershell.exe`、`wsl.exe` 或 `ssh.exe` 的配置
- **THEN** 系统按配置创建本地 PTY 且不创建 SSH、堡垒机或容器领域对象

### Requirement: Session-Scoped Agent Panel
桌面端 MUST 为当前 Session 提供独立 Agent 面板，展示自然语言输入、任务状态、Tool 调用、命令输出摘要和最终结果。

#### Scenario: Start an Agent Task
- **WHEN** 用户在已就绪 Session 的 Agent 面板提交自然语言目标
- **THEN** 系统创建绑定该 Session 的 Agent Task 并显示其时间线

#### Scenario: Change selected tab
- **WHEN** 用户切换到另一个 Session 标签页
- **THEN** 系统显示目标 Session 自己的 Agent 状态且不得隐式迁移原任务

### Requirement: Approval and Takeover Controls
桌面端 MUST 提供命令批准、拒绝、Agent 取消、命令中断和 User Takeover 的明确独立控件。

#### Scenario: Review a mutating command
- **WHEN** Agent 请求执行需要授权的命令
- **THEN** UI 显示完整命令、目标 Session、目的和风险，并允许用户批准或拒绝

#### Scenario: Take over an interactive terminal
- **WHEN** Command Transaction 进入 `interaction_required`
- **THEN** UI 显示接管状态并允许用户获得输入控制权

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

