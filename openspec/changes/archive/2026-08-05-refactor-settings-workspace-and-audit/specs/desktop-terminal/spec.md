## MODIFIED Requirements

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
