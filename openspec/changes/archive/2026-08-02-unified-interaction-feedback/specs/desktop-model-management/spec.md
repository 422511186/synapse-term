## MODIFIED Requirements

### Requirement: Prototype Model Catalog
桌面端 MUST 复刻在线原型的“模型配置 (Model Configuration)”二级页：返回工作区入口、标题、说明、表格列、状态标记和“新增模型配置”按钮的文案、排列、颜色和间距均 MUST 与原型一致。模型记录必须来自 `models.list()`，并保留启用、默认、删除和检测操作。启用/停用与设为默认 MUST 采用乐观更新并在失败时回滚；删除 MUST 先确认后执行；检测 MUST 展示进行中/成功/失败三态；所有行内操作 MUST 防连点。

#### Scenario: Open the model catalog
- **WHEN** 用户从 Header 进入模型配置
- **THEN** 系统 MUST 显示原型模型表格，并展示实际模型的 Provider、Context、状态和编辑入口

#### Scenario: Open a model editor
- **WHEN** 用户选择任一示例模型的编辑入口或“新增模型配置”
- **THEN** 系统 MUST 打开原型大小和位置的“编辑模型配置”Dialog

#### Scenario: Toggle model enabled optimistically
- **WHEN** 用户点击模型的启用/停用按钮
- **THEN** 系统 MUST 立即更新徽标与文案并 toast 确认；若 `models.setEnabled()` 失败 MUST 回滚到原状态并 toast 错误

#### Scenario: Delete model requires confirmation
- **WHEN** 用户点击"删除"且模型操作未在 pending 中
- **THEN** 系统 MUST 展示确认对话框，确认后按钮进入"删除中…"态并调用 `models.remove()`，完成后 toast 删除结果

#### Scenario: Test model in the catalog
- **WHEN** 用户点击"检测"
- **THEN** 按钮 MUST 显示"检测中…"并禁用，重复点击被忽略；校验结果为 `available` 时 toast 展示"检测通过"与耗时并更新可用性徽标，校验结果为 `unavailable` 时 MUST toast 展示原因且不得显示"检测通过"

### Requirement: Prototype Model Editor
模型编辑 Dialog MUST 复刻原型的 Provider、模型 ID、展示名称、Context Window、自动压缩阈值、拉取远程模型和保存按钮。拉取必须调用 `providers.discoverModels()`，选择项 MUST 回填模型 ID，保存必须调用 `models.save()`。Dialog MUST 同时为新建与编辑中的模型提供"检测模型"入口：新建模型检测 MUST 先保存草稿再调用 `models.test()`；检测过程 MUST 显示"检测中…"与禁用态，成功 MUST 显示"检测通过"并 toast（含耗时），失败 MUST 保留弹窗并展示原因。

#### Scenario: Fetch prototype model choices
- **WHEN** 用户在模型编辑 Dialog 选择“拉取远程模型”
- **THEN** 按钮 MUST 显示原型加载状态，完成后 MUST 显示 Provider 返回的模型 ID 列表

#### Scenario: Select a fetched prototype model
- **WHEN** 用户从拉取列表选择模型 ID
- **THEN** Dialog MUST 更新模型 ID 输入框并关闭该列表

#### Scenario: Test an existing model from the editor
- **WHEN** 用户在编辑已有模型时点击"检测模型"
- **THEN** 按钮 MUST 显示"检测中…"并防连点；校验结果为 `available` 时短暂显示"检测通过"+ 耗时并 toast，校验结果为 `unavailable` 时 toast 展示分类原因且按钮回到待命态

#### Scenario: Test a new model before saving
- **WHEN** 用户在新建模型 Dialog 填写必要字段后点击"检测模型"
- **THEN** 系统 MUST 先保存草稿再调用 `models.test()`；成功时按钮显示"检测通过"，失败时保留弹窗并展示错误，不丢失已填写内容
