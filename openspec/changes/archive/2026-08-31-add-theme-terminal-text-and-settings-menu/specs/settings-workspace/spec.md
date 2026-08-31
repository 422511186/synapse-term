## ADDED Requirements

### Requirement: Settings Menu Categorization
设置工作区 MUST 将配置区块按分类组织为左侧导航菜单（至少包含「通用」「外观」「MCP 服务」分类；主题与终端文字配置归入「外观」分类）；MUST 一次只显示一个分类的内容面板，点击菜单项 MUST 切换对应面板，当前分类 MUST 有视觉高亮。

#### Scenario: Navigate between categories
- **WHEN** 用户点击左侧导航中的「外观」菜单项
- **THEN** 系统 MUST 显示主题配置面板并高亮「外观」菜单项，且 MUST 隐藏其他分类的内容面板

## MODIFIED Requirements

### Requirement: Dedicated Settings Workspace
桌面端 MUST 提供独立的 Settings Workspace。用户点击 Header 设置按钮时，系统 MUST 进入设置工作区而不是打开混合下拉菜单；设置工作区 MUST 保留 `Synapse Term` 品牌外观、返回 Terminal Session 工作区的入口，并通过左侧分类导航组织配置区块。

#### Scenario: Open the Settings Workspace
- **WHEN** 用户点击 Header 的“设置”按钮
- **THEN** 系统 MUST 进入 Settings Workspace，显示左侧分类导航与当前分类内容，且 MUST NOT 显示任何配置主题或设置下拉菜单

### Requirement: Theme Configuration Section
设置工作区的「外观」分类 MUST 提供主题配置区块，包含：主题模式选择（浅色 / 深色 / 跟随系统，默认跟随系统）；自定义配色开关与背景、前景、强调色三个颜色选择器；终端文字颜色编辑器（终端前景与 ANSI 颜色）；所有操作 MUST 经受限 preload API 交由 Main 处理，Renderer MUST NOT 直接访问设置文件或系统外观 API。

#### Scenario: Change theme mode from settings
- **WHEN** 用户进入设置工作区的「外观」分类并把模式从「跟随系统」改为「浅色」
- **THEN** 界面 MUST 立即以浅色配色渲染，且选择 MUST 被持久化

#### Scenario: Edit custom palette from settings
- **WHEN** 用户启用自定义配色并修改背景颜色或终端文字颜色
- **THEN** 设置工作区与终端工作区 MUST 立即反映新的颜色，且修改 MUST 被持久化

## REMOVED Requirements

### Requirement: Settings Page Placeholder
**Reason**: 设置工作区已提供真实配置区块（通用 / 外观 / MCP 服务），并新增左侧分类导航；「暂无设置项」占位内容需求已过时，且与菜单分类导航直接冲突。
**Migration**: 以「Settings Menu Categorization」与各分类内容面板需求取代。
