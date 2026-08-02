# desktop-terminal Specification

## MODIFIED Requirements

### Requirement: Desktop Terminal Workspace

桌面端 MUST 将 [在线原型](https://cat-portal-41791527.figma.site/) 的 `Synapse Term` 工作区逐像素复刻为默认 Renderer 画面。Header MUST 为 56px；1440×900 时 Terminal/Agent 内容列 MUST 为 890px/550px，980×640 时 MUST 为 500px/480px；Header、Agent 和根背景 MUST 为 `#09090b`，Terminal MUST 为 `#000000`。

#### Scenario: Render the wide desktop workspace
- **WHEN** Renderer 在 1440×900 启动工作区
- **THEN** 系统 MUST 显示 56px Header、890px 黑色终端和 550px Agent 面板，且不得出现旧品牌、Session rail 或额外布局列

#### Scenario: Render the compact desktop workspace
- **WHEN** Renderer 在 980×640 启动工作区
- **THEN** 系统 MUST 显示 56px Header、500px 黑色终端和 480px Agent 面板，且不得切换为移动抽屉或隐藏 Agent

#### Scenario: Preserve terminal typography while streaming runtime output
- **WHEN** 用户查看或输入到活动终端
- **THEN** 系统 MUST 使用 `TerminalView` 呈现该会话的实际 replay/输出，并使用 `JetBrains Mono`、14px 字号、约 22.75px 行高和 20px 内边距

### Requirement: Session-Scoped Agent Panel

桌面端 MUST 呈现原型的固定 Agent 面板，包括 40px 的 `Agent Timeline`/`审计日志 (Audit)` Tabs 和底部 Composer；Timeline、审批和 Audit 卡片必须使用原型视觉，但数据来自 `agent.history`、`agent.onTimeline` 与 `audit.list`。

#### Scenario: Approve a prototype tool request
- **WHEN** 用户在 Timeline 中选择“批准执行”
- **THEN** 系统 MUST 调用 `agent.approve`，并在事件更新后将审批卡片替换为成功状态

#### Scenario: Reject a prototype tool request
- **WHEN** 用户在 Timeline 中选择“拒绝接管”
- **THEN** 系统 MUST 调用 `agent.takeover` 或取消操作，并在事件更新后显示拒绝/接管状态

#### Scenario: View runtime audit rows
- **WHEN** 用户选择 `审计日志 (Audit)`
- **THEN** 系统 MUST 请求活动会话的审计记录，并以原型的颜色和等宽字体显示这些记录

## ADDED Requirements

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
