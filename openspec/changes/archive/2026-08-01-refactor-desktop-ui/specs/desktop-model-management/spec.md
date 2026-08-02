# desktop-model-management Specification

## ADDED Requirements

### Requirement: Prototype Model Catalog

桌面端 MUST 复刻在线原型的“模型配置 (Model Configuration)”二级页：返回工作区入口、标题、说明、表格列、状态标记和“新增模型配置”按钮的文案、排列、颜色和间距均 MUST 与原型一致。模型记录必须来自 `models.list()`，并保留启用、默认、删除和检测操作。

#### Scenario: Open the model catalog
- **WHEN** 用户从 Header 进入模型配置
- **THEN** 系统 MUST 显示原型模型表格，并展示实际模型的 Provider、Context、状态和编辑入口

#### Scenario: Open a model editor
- **WHEN** 用户选择任一示例模型的编辑入口或“新增模型配置”
- **THEN** 系统 MUST 打开原型大小和位置的“编辑模型配置”Dialog

### Requirement: Prototype Model Editor

模型编辑 Dialog MUST 复刻原型的 Provider、模型 ID、展示名称、Context Window、自动压缩阈值、拉取远程模型和保存按钮。拉取必须调用 `providers.discoverModels()`，选择项 MUST 回填模型 ID，保存必须调用 `models.save()`。

#### Scenario: Fetch prototype model choices
- **WHEN** 用户在模型编辑 Dialog 选择“拉取远程模型”
- **THEN** 按钮 MUST 显示原型加载状态，完成后 MUST 显示 Provider 返回的模型 ID 列表

#### Scenario: Select a fetched prototype model
- **WHEN** 用户从拉取列表选择模型 ID
- **THEN** Dialog MUST 更新模型 ID 输入框并关闭该列表

### Requirement: Prototype Provider Catalog and Editor

桌面端 MUST 复刻在线原型的“服务商凭据 (Provider Profiles)”二级页、Provider 卡片、`测试连接 / 编辑`、`配置凭据` 和 `新增 Provider` 操作。卡片必须来自 `providers.list()`；Provider Dialog MUST 复刻名称、协议支持、Base URL、API Key、测试连接、取消和保存凭据，保存必须调用 `providers.save()`。

#### Scenario: Open a Provider editor
- **WHEN** 用户从 Provider 卡片选择“测试连接 / 编辑”、配置凭据或新增 Provider
- **THEN** 系统 MUST 打开原型大小和位置的“配置服务商”Dialog

#### Scenario: Test a prototype provider connection
- **WHEN** 用户在 Provider Dialog 选择“测试连接”
- **THEN** 系统 MUST 先保存编辑后的 Provider，再调用 `providers.discoverModels()` 验证连接；按钮依次显示“连接中...”和成功或错误状态

#### Scenario: Return from a prototype configuration page
- **WHEN** 用户选择模型或 Provider 页的“返回工作区”
- **THEN** 系统 MUST 返回原型工作区的 Header、Terminal 和 Agent 默认布局
