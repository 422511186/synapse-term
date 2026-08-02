## ADDED Requirements

### Requirement: Global Settings Menu Order
桌面全局设置菜单 MUST 将“服务商配置”入口排列在“模型配置”入口上方；其余菜单项（MCP 服务、ACP 驱动等）顺序 MUST 保持不变。

#### Scenario: Open the global settings menu
- **WHEN** 用户打开桌面 Header 的全局设置菜单
- **THEN** 菜单按“服务商配置 → 模型配置 → MCP 服务 → ACP 驱动”顺序展示，且两个入口的图标与点击行为不变
