## MODIFIED Requirements

### Requirement: Global Settings Menu Order
桌面端 MUST 使用独立 Settings Workspace 承载全局设置主题，而不得继续使用把配置和其他动作混在一起的全局设置下拉菜单。Settings Workspace 左侧 MUST 按“配置 → 外部接入 → 安全与诊断”分组展示主题；“服务商配置” MUST 位于“模型配置”上方；服务商和模型 MUST 仍然是两个独立的配置页面。

#### Scenario: Open the global Settings Workspace
- **WHEN** 用户点击桌面 Header 的“设置”按钮
- **THEN** 系统 MUST 进入 Settings Workspace，左侧 MUST 显示“服务商配置 → 模型配置 → MCP 服务 → ACP 集成 → 审计日志”的可导航主题顺序，并默认选中“服务商配置”

#### Scenario: Open the Provider topic before the Model topic
- **WHEN** 用户首次进入 Settings Workspace
- **THEN** 系统 MUST 先显示 Provider 配置内容；用户选择“模型配置”后 MUST 进入独立 Model 配置内容，不得把两类配置合并为同一页面

#### Scenario: Switch from Provider to Model settings
- **WHEN** 用户在 Settings Workspace 左侧从“服务商配置”切换到“模型配置”
- **THEN** 右侧 MUST 显示实际 `models.list()` 驱动的模型管理页，Provider 已保存的数据 MUST 保持不变
