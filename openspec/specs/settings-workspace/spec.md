# settings-workspace Specification

## Purpose
规定桌面端单页设置工作区：独立进入、返回终端工作区，以及占位内容展示。

## Requirements

### Requirement: Dedicated Settings Workspace
桌面端 MUST 提供独立的 Settings Workspace。用户点击 Header 设置按钮时，系统 MUST 进入设置工作区而不是打开混合下拉菜单；设置工作区 MUST 保留 `Synapse Term` 品牌外观、返回 Terminal Session 工作区的入口和占位内容，MUST NOT 显示左侧主题导航。

#### Scenario: Open the Settings Workspace
- **WHEN** 用户点击 Header 的“设置”按钮
- **THEN** 系统 MUST 进入单页 Settings Workspace，显示占位内容，且 MUST NOT 显示任何配置主题或设置下拉菜单

### Requirement: Settings Page Placeholder
Settings Workspace MUST 显示一个只读占位内容“暂无设置项”，MUST NOT 提供服务商、模型、MCP、ACP 或审计配置入口。

#### Scenario: Open settings placeholder
- **WHEN** 用户进入 Settings Workspace
- **THEN** 页面显示“暂无设置项”占位，且没有可点击的配置主题导航

### Requirement: Return to Terminal Workspace
Settings Workspace MUST 提供明确的“返回工作区”操作；返回后 MUST 恢复 Terminal Session 工作区的 Header、终端和活动 Session 状态，不得创建新的 Session。

#### Scenario: Return from settings
- **WHEN** 用户点击 Settings Workspace 的“返回工作区”
- **THEN** 系统 MUST 返回 Terminal Session 工作区，并保留进入设置前的活动 Session
