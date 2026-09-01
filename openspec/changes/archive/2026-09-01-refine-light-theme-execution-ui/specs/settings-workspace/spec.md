## ADDED Requirements

### Requirement: Settings Readability Across Schemes

设置工作区的正文、说明、标签、按钮、输入控件、风险提示、选中态和禁用态 MUST 使用与当前有效 scheme 匹配的语义颜色。正常文字与其背景对比度 MUST 至少为 4.5:1，非文字控件边界与焦点指示 MUST 至少为 3:1；状态不能只依赖颜色表达，选中、聚焦、危险和禁用状态还 MUST 具有边框、图标、文字或明度差异。

#### Scenario: Light settings remain readable

- **WHEN** 用户在有效 scheme 为 `light` 时打开设置工作区并查看通用、外观或 MCP 服务区块
- **THEN** 主要文字、辅助说明、模式选项、Token 控件、警告和操作按钮 MUST 清晰可读，不得使用仅适用于深色背景的浅色文字

#### Scenario: Settings states are distinguishable

- **WHEN** 用户在设置工作区中悬停、聚焦、选中、禁用或触发危险操作
- **THEN** 对应控件 MUST 以符合当前 scheme 的边框、背景、图标或文字变化清晰表达状态，并保留可见焦点指示

#### Scenario: Settings remain usable at narrow width

- **WHEN** 设置工作区宽度不足以并排展示导航、卡片或操作按钮
- **THEN** 内容 MUST 按既定响应式布局换行或堆叠，文字、按钮和输入控件不得相互覆盖、被裁切或溢出视口
