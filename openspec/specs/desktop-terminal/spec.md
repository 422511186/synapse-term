# desktop-terminal Specification

## Purpose
规定 Windows 桌面终端工作区的 Session 创建与切换、基础终端交互、Session-scoped Agent 面板、审批与接管控件、UI 重连、Renderer 隔离和可见失败状态。
## Requirements
### Requirement: Desktop Terminal Workspace
系统 MUST 提供 Windows 桌面终端工作区，允许当前用户创建、查看、切换和关闭 Terminal Session 标签页。每个活动标签 MUST 显示会话标题、来自运行时摘要的终端类型和可访问的关闭操作；新建标签入口 MUST 始终可达，且不得依赖用户在标题中手工标注类型。

#### Scenario: Create a terminal tab
- **WHEN** 用户选择一个有效的启动配置创建终端
- **THEN** 系统创建新的 Session 标签页并显示其实时终端内容

#### Scenario: Switch terminal tabs
- **WHEN** 用户在多个活动 Session 标签页之间切换
- **THEN** 系统显示所选 Session 的终端状态且不改变其他 Session 的运行状态

#### Scenario: Navigate many terminal tabs
- **WHEN** 活动 Session 数量超过标签栏可见宽度或全部会话弹层可见高度
- **THEN** 用户 MUST 能通过水平滚动标签栏或搜索、滚动全部会话视图选择任一 Session，且新建入口仍可达

#### Scenario: Session runtime state changes
- **WHEN** Core 广播某个活动 Session 的状态、方言或终端类型变化
- **THEN** 对应标签和全部会话视图 MUST 更新该 Session，且不得重建其他 Session 的终端状态

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
系统 SHALL 支持由 executable、args、cwd、环境变量引用和初始尺寸组成的本地启动配置，且不得要求配置远程连接类型。

#### Scenario: Launch arbitrary local command
- **WHEN** 用户选择启动 `powershell.exe`、`wsl.exe` 或 `ssh.exe` 的配置
- **THEN** 系统按配置创建本地 PTY 且不创建 SSH、堡垒机或容器领域对象

### Requirement: Session-Scoped Agent Panel
桌面端 MUST 呈现当前 Session 的固定 Agent 面板，包括 40px 的 `Agent Timeline`/`审计日志 (Audit)` Tabs 和底部 Composer；Timeline、审批和 Audit 卡片必须使用原型视觉，但数据来自 `agent.history`、`agent.onTimeline` 与 `audit.list`。

#### Scenario: Start an Agent Task
- **WHEN** 用户在已就绪 Session 的 Agent 面板提交自然语言目标
- **THEN** 系统创建绑定该 Session 的 Agent Task 并显示其时间线

#### Scenario: Change selected tab
- **WHEN** 用户切换到另一个 Session 标签页
- **THEN** 系统显示目标 Session 自己的 Agent 状态且不得隐式迁移原任务

#### Scenario: Approve a prototype tool request
- **WHEN** 用户在 Timeline 中选择“批准执行”
- **THEN** 系统 MUST 调用 `agent.approve`，并在事件更新后将审批卡片替换为成功状态

#### Scenario: Reject a prototype tool request
- **WHEN** 用户在 Timeline 中选择“拒绝接管”
- **THEN** 系统 MUST 调用 `agent.takeover` 或取消操作，并在事件更新后显示拒绝/接管状态

#### Scenario: View runtime audit rows
- **WHEN** 用户选择 `审计日志 (Audit)`
- **THEN** 系统 MUST 请求活动会话的审计记录，并以原型的颜色和等宽字体显示这些记录

### Requirement: Approval and Takeover Controls
桌面端 MUST 提供命令批准、拒绝、Agent 取消、命令中断和 User Takeover 的明确独立控件。Approval 卡片 MUST 以唯一 approval id 显示生命周期；完成、取消、过期、任务结束或环境失效后不得继续显示可操作的批准按钮。

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

### Requirement: Cancellation Remains Available During Agent Blocking States
桌面端 MUST 在 Agent 等待审批、环境 Probe、Provider 输出或 Tool Result 时保持取消任务控件可用；显示可恢复错误时不得用全屏遮罩阻断取消操作，除非用户明确关闭该提示后继续。

#### Scenario: Cancel from approval waiting state
- **WHEN** Timeline 显示待审批卡片且用户点击取消任务
- **THEN** 请求发送到当前 Session 的活动 Agent Task，Core 返回 cancelled，UI 清除 active turn 和待审批操作

#### Scenario: Stale approval error is shown
- **WHEN** 用户点击旧审批导致 `approval_invalid` 或 `Approval is no longer pending`
- **THEN** UI 刷新当前 Agent 状态并将旧卡片置为不可操作，取消任务仍可点击且不会被错误弹层永久遮挡

### Requirement: Prototype Context Controls
工作区 Header MUST 复刻原型的 `Synapse Term` 品牌、运行中/历史会话、方言、资源监控、模型、权限和设置控件。下拉菜单 MUST 具有原型文案、顺序、宽度和示例状态，互斥打开，并能进入相应的 Dialog 或二级页。

#### Scenario: Select a runtime session
- **WHEN** 用户从会话菜单选择另一个会话
- **THEN** Header、xterm、资源、Timeline 和 Audit MUST 切换到所选会话，且菜单关闭

#### Scenario: Open an alternate context menu
- **WHEN** 一个 Header 下拉菜单已打开且用户点击另一个 Header 控件
- **THEN** 系统 MUST 关闭旧菜单，只显示新菜单，位置和尺寸与原型相符

#### Scenario: Navigate to configuration pages
- **WHEN** 用户从模型菜单或设置菜单选择模型或服务商配置
- **THEN** 系统 MUST 显示对应原型二级页并保留相同 Header 外观

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
