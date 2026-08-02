## ADDED Requirements

### Requirement: Simplified Chinese Product UI
桌面端所有应用内用户可见产品文案 MUST 使用简体中文，包括按钮、tooltip、状态、空状态、审批、接管、模型测试和错误提示；Electron 原生应用菜单 MUST 被移除且不得通过 `Alt` 重新显示。

#### Scenario: Open the packaged application
- **WHEN** 用户启动 v0.2.0 桌面程序
- **THEN** 产品 UI 使用简体中文、窗口不显示原生菜单栏，命令、路径、终端原始输出、模型回复和协议专有名词保持原文

### Requirement: Shell Availability and Dialect Controls
Session 创建界面 MUST 显示动态发现的 Git Bash、PowerShell 和 WSL 可用性，Session 工具栏 SHALL 显示并允许用户修改当前 execution dialect。

#### Scenario: Git Bash is installed but not in PATH
- **WHEN** Shell locator 通过注册表或环境位置找到 Git Bash
- **THEN** 创建界面允许选择 Git Bash 并使用解析后的真实路径

#### Scenario: Selected shell is unavailable
- **WHEN** 用户选择系统未发现的 Shell
- **THEN** UI 禁止创建并显示可操作的中文安装或路径提示

### Requirement: Dedicated Model Management Page
桌面端 MUST 提供独立于 Terminal workspace 和 Agent panel 的“模型”功能页面，不得只用设置弹窗或在 composer 内嵌完整编辑表单；页面 SHALL 分别管理 Model Configuration 与 Provider Profile。

#### Scenario: Open model management
- **WHEN** 用户从顶层导航进入“模型”
- **THEN** 主内容区显示模型目录以及 Provider 连接视图，Terminal Session 保持由 Core 管理且 Agent composer 不承担配置编辑

#### Scenario: Configure two models on one provider
- **WHEN** 用户在 Provider 连接视图保存一个连接并在模型配置视图创建两个模型
- **THEN** 两个 Model Configuration 分别显示模型 ID、启用、默认和验证状态，并引用同一个 Provider Profile

### Requirement: Model Discovery Workflow
模型配置视图 MUST 在选定 Provider Profile 后提供“拉取模型”操作，并 SHALL 把有界 Discovered Model 结果提供给模型 ID 下拉选择；Provider 连接视图 MUST 只管理连接字段。对不支持 Models API 的连接，模型 ID SHALL 保留手动输入回退。

#### Scenario: Pull and select a model ID
- **WHEN** 用户在模型配置视图选择已保存 Provider 并拉取 `/v1/models`
- **THEN** 页面在当前模型配置中显示可搜索下拉结果，选中项回填模型 ID，保存后仍标记为“待检测、未启用”

#### Scenario: Model listing fails
- **WHEN** 拉取发生鉴权、网络、超时或 unsupported 错误
- **THEN** 页面保留现有模型配置并显示稳定中文原因，不暴露凭据或清空之前的发现结果

### Requirement: Model Test Feedback
模型页面 MUST 显示 Model Configuration 验证进行中、成功或失败结果，以及能力、检测时间和具体原因；同一模型测试进行中时按钮不得重复触发。

#### Scenario: Provider connection fails
- **WHEN** Core 通过引用的 Provider Profile 返回 connection 或 TLS 失败
- **THEN** UI 显示中文原因和原始技术详情，且不只改变无文字状态点

### Requirement: Local File Tool Activity
Agent 面板 MUST 展示本机文件 Tool 的相对路径、操作、状态、审批和结果摘要，并在修改前按策略展示 Diff。

#### Scenario: Agent edits a sensitive file
- **WHEN** `local_edit_file` 被本地策略判定需要审批
- **THEN** UI 显示相对路径、Diff、风险和批准/拒绝控件

### Requirement: Adaptive Workspace Theme
桌面端 MUST 支持 `system`、`light` 和 `dark` 主题，默认跟随操作系统，并 SHALL 同步终端背景、前景和 ANSI 可读性。

#### Scenario: Operating system changes appearance
- **WHEN** 主题设为 `system` 且操作系统从明亮切换为暗黑
- **THEN** 应用和终端无需重启即可切换到暗黑语义颜色且文本无重叠或不可读

#### Scenario: Read ANSI white text in light theme
- **WHEN** 主题设为 `light` 且终端输出使用 ANSI white 或 bright white
- **THEN** xterm 将这些颜色映射为对浅色背景可读的深色前景，光标和选区也保持清晰对比

### Requirement: Markdown Agent Timeline
assistant 回复 MUST 在 Timeline 中使用安全 Markdown 渲染，支持 GFM、代码块、表格、列表和链接；模型 HTML SHALL 不得直接执行或注入 DOM。

#### Scenario: Model returns diagnostics with code and table
- **WHEN** assistant 流式输出 Markdown 表格和 fenced code block
- **THEN** 同一稳定 Timeline Item 增量更新并在完成后呈现可读表格与代码，不重复最终答案

### Requirement: Composer Runtime Controls
Agent composer MUST 在固定于面板底部的紧凑工具栏中提供已启用 Model Configuration、推理强度和 Permission Mode 控件，并在活动 Turn 中固定所选模型、禁用重复发送、允许取消，在空闲时允许重置 Conversation。工具栏不得随输入框内容或滚动位置移动；Provider Profile 和 Model Configuration 的编辑功能 MUST 只存在于独立模型页面。

#### Scenario: Turn is active
- **WHEN** 用户已经提交消息且模型或 Tool 仍在运行
- **THEN** 发送按钮禁用、取消按钮可用且模型/权限设置不能静默改变当前 Turn

#### Scenario: No eligible model exists
- **WHEN** 没有已启用的 Model Configuration
- **THEN** composer 禁止发送、说明需要先配置并启用模型，并提供进入独立模型页面的操作入口

### Requirement: Simplified Session Dialog
标准 Session 创建界面 MUST 只要求用户选择名称和可用 Shell，cwd SHALL 由 Main 动态设为当前用户 home 且不得在普通界面要求填写 working directory。

#### Scenario: Create a default PowerShell Session
- **WHEN** 用户保留默认名称并选择 PowerShell
- **THEN** Main 使用动态 home 创建 Session，终端直接位于用户目录且 UI 不显示 cwd 输入框

### Requirement: Session Resource View
桌面右侧面板顶部 MUST 展示当前 Session 的资源刷新状态、采集时间和 CPU、内存、磁盘、网络、主机、OS、uptime 等可用指标，并明确区分未刷新、不可用和采集失败。左侧不得为 Session 或资源保留常驻面板。

#### Scenario: No snapshot has been collected
- **WHEN** 用户刚通过 SSH 或堡垒机进入目标环境但尚未点击刷新
- **THEN** 资源区显示“待刷新”而不是展示本机或伪造的零值

### Requirement: Top Session Tabs and Collapsible Right Panel
桌面端 MUST 使用主终端顶部标签管理已打开 Session，并 MUST 支持拖拽调整终端与 Agent 侧栏宽度。资源区 SHALL 可独立折叠，折叠后 Agent 时间线占用释放出的全部高度；关闭整个右侧面板时终端列 MUST 占满可用宽度。

#### Scenario: Switch between multiple sessions
- **WHEN** 用户同时打开三个 Session
- **THEN** 终端顶部显示三个可切换、可关闭标签和新建按钮，页面不显示左侧 Session 列表

#### Scenario: Close the right panel
- **WHEN** 用户关闭右侧资源/Agent 面板
- **THEN** 右侧网格轨道被移除，xterm 容器的右边界扩展到主工作区右边界，不留空白列

#### Scenario: Collapse resources and resize Agent panel
- **WHEN** 用户折叠资源区并拖动终端与 Agent 之间的分隔条
- **THEN** 资源内容停止占用高度、聊天区域扩展，Agent 面板宽度在有界范围内实时变化且 composer 控件保持固定

### Requirement: Compact Consistent Tool Timeline
Agent Tool 活动 MUST 在实时事件和重新加载的历史中使用同一紧凑、可折叠的时间线表现；摘要只显示 Tool、状态和命令或路径，长结果仅在展开后出现在有界内容区。审批控件 MUST 只在 `waiting_approval` 状态出现，批准、拒绝或交互结束后原卡片必须原位转为不可操作终态。Agent 面板正文、时间线元信息、Tool 摘要和输入控件 MUST 使用适合桌面持续阅读的可读字号，不能依赖过小文字换取密度。

#### Scenario: Return to a session with tool history
- **WHEN** 用户切换到其他 Session 后再返回包含 Tool Call/Result 的 Conversation
- **THEN** 历史与执行时展示一致，不新增突兀的“历史”大块结果，长输出默认折叠且不会挤占聊天区域

#### Scenario: Read a dense Agent timeline
- **WHEN** Agent 时间线同时包含正文、状态、Tool 摘要和审批元信息
- **THEN** 主要正文和交互控件清晰可读，次要元信息仍有视觉层级但不使用难以辨认的微小字号

## MODIFIED Requirements

### Requirement: Launch Profiles
系统 SHALL 支持由动态解析 executable、args、cwd、环境变量引用、execution dialect 和初始尺寸组成的本地启动配置，且不得要求配置远程连接类型或在 Renderer 写死本机路径。

#### Scenario: Create a Git Bash Session
- **WHEN** 用户选择动态发现的 Git Bash 和默认用户 home cwd
- **THEN** 系统使用 Main 提供的真实 executable 与 cwd 创建 PTY且不依赖 `bash.exe` 位于 PATH

### Requirement: Session-Scoped Agent Panel
桌面端 MUST 为当前 Session 提供独立多轮 Agent Conversation，展示自然语言输入、聚合流式回复、Tool 调用、命令/文件结果、审批、接管和最终状态。

#### Scenario: Ask a simple question
- **WHEN** 用户发送普通对话且模型不调用 Tool
- **THEN** 面板流式聚合显示一条 assistant 回复且不重复最终文本

#### Scenario: Run a multi-tool task
- **WHEN** Agent 连续调用终端和本机文件 Tool
- **THEN** 面板按顺序显示每个 Tool 状态并最终显示基于结果的结论

### Requirement: Visible Failure States
桌面端 MUST 明确展示 Session 中断、Core 版本不兼容、Provider 验证、Agent Turn、Tool、日志缺口和不确定命令状态，并提供稳定中文说明和必要技术详情。

#### Scenario: Agent model request fails
- **WHEN** Provider 在 Turn 中返回错误
- **THEN** UI 追加失败 system item、恢复输入控件且审计包含错误码和原因
