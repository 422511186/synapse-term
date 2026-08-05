# settings-workspace Specification

## Purpose
TBD: 定义桌面端独立设置工作区、分组导航和主题切换行为。

## Requirements
### Requirement: Dedicated Settings Workspace
桌面端 MUST 提供独立的 Settings Workspace。用户点击 Header 设置按钮时，系统 MUST 进入设置工作区而不是打开混合下拉菜单；设置工作区 MUST 在左侧显示导航，在右侧显示当前 Settings Topic 内容，并保留返回 Terminal Session 工作区的入口。

#### Scenario: Open the Settings Workspace
- **WHEN** 用户点击 Header 的“设置”按钮
- **THEN** 系统 MUST 进入 Settings Workspace，默认选中“服务商配置”，且 MUST 不显示包含清空 Agent 会话或退出 Core 的设置下拉菜单

### Requirement: Grouped Settings Navigation
Settings Workspace MUST 按以下分组展示可导航主题，一级分组标题本身 MUST 是可点击的页面入口，并进入该分组声明的默认主题；二级主题 MUST 以更深缩进和独立选中态呈现：

- 配置：服务商配置、模型配置
- 外部接入：MCP 服务、ACP 集成
- 安全与诊断：审计日志

#### Scenario: Render grouped navigation
- **WHEN** 用户打开 Settings Workspace
- **THEN** 左侧 MUST 按“配置 → 外部接入 → 安全与诊断”顺序展示分组，并在配置分组中将“服务商配置”排列在“模型配置”之前

#### Scenario: Open a group through its top-level heading
- **WHEN** 用户点击“配置”“外部接入”或“安全与诊断”一级分组标题
- **THEN** 系统 MUST 进入该分组的默认主题，且二级主题 MUST 保持更深缩进和可识别的选中态

### Requirement: Independent Settings Topics
每个 Settings Topic MUST 是独立可进入的内容区域；切换主题 MUST 只改变右侧内容，不得把服务商、模型、MCP、ACP 和审计合并成一个配置页面，也不得改变已保存的其他主题数据。

#### Scenario: Switch between settings topics
- **WHEN** 用户从左侧点击“模型配置”“MCP 服务”“ACP 集成”或“审计日志”中的任一主题
- **THEN** 右侧 MUST 显示对应主题的真实运行时内容，左侧 MUST 保持可见，且设置工作区 MUST 不返回 Terminal Session 工作区

### Requirement: Return to Terminal Workspace
Settings Workspace MUST 提供明确的“返回工作区”操作；返回后 MUST 恢复 Terminal Session 工作区的 Header、终端、Agent 时间线和 Composer 状态，不得创建新的 Session 或 Agent Task。

#### Scenario: Return from settings
- **WHEN** 用户点击 Settings Workspace 的“返回工作区”
- **THEN** 系统 MUST 返回 Terminal Session 工作区，并保留进入设置前的活动 Session 和 Agent 状态

### Requirement: Session Actions Stay Outside Settings Navigation
设置导航 MUST 不提供清空 Agent 会话或退出 Core 的操作。清空 Agent 会话 MUST 继续通过 `/clear` command 触发；正常退出 App MUST 继续负责终止 Core，Settings Workspace 不得新增 Core 生命周期页面。

#### Scenario: Clear an Agent conversation through the command
- **WHEN** 用户在 Agent Composer 输入并执行 `/clear`
- **THEN** 系统 MUST 继续调用现有会话重置流程，且 Settings Workspace MUST 不提供第二个清空入口

#### Scenario: Exit the application normally
- **WHEN** 用户关闭应用
- **THEN** Electron MUST 继续执行现有 `terminate_all` Core 关闭流程，且 Settings Workspace MUST 不显示单独的“退出 Core”入口
