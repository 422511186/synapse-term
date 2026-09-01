# settings-workspace Delta

## ADDED Requirements

### Requirement: Theme Configuration Section
设置工作区 MUST 提供「外观 / 主题」配置区块，包含：主题模式选择（浅色 / 深色 / 跟随系统，默认跟随系统）；自定义配色开关与背景、前景、强调色三个颜色选择器；所有操作 MUST 经受限 preload API 交由 Main 处理，Renderer MUST NOT 直接访问设置文件或系统外观 API。

#### Scenario: Change theme mode from settings
- **WHEN** 用户进入设置工作区的「外观 / 主题」区块并把模式从「跟随系统」改为「浅色」
- **THEN** 界面 MUST 立即以浅色配色渲染，且选择 MUST 被持久化

#### Scenario: Edit custom palette from settings
- **WHEN** 用户启用自定义配色并修改背景颜色
- **THEN** 设置工作区与终端工作区 MUST 立即反映新的背景色，且修改 MUST 被持久化
