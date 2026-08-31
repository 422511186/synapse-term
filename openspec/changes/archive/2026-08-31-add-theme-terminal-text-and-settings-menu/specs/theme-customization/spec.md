## MODIFIED Requirements

### Requirement: Custom Core Palette
桌面端 MUST 允许用户自定义核心配色与终端文字配色：核心配色包括背景（background）、前景（foreground）与强调色（accent），终端文字配色包括终端前景与 16 个 ANSI 颜色（black/red/green/yellow/blue/magenta/cyan/white 及其 bright 变体）；自定义配色 MUST 有显式启用开关，关闭时 MUST 使用内置浅色/深色主题的默认值。颜色输入 MUST 为合法的六位十六进制颜色，非法值 MUST 在持久化时被拒绝并保留原值。

#### Scenario: Enable custom colors
- **WHEN** 用户启用自定义配色并设置背景、前景、强调色
- **THEN** 桌面 UI 的背景、前景文字与强调色 MUST 使用自定义值，其余表面沿用当前内置主题的默认值

#### Scenario: Customize terminal text colors
- **WHEN** 用户启用自定义配色并编辑终端文字颜色（如将红色设为指定值）
- **THEN** 终端表面对应的 ANSI 颜色 MUST 使用自定义值

#### Scenario: Reject an invalid color
- **WHEN** 用户在颜色输入中提交一个非六位十六进制值
- **THEN** 系统 MUST 拒绝该值并保持上一次合法的颜色设置不变

#### Scenario: Disable custom colors
- **WHEN** 用户关闭自定义配色开关
- **THEN** 桌面 UI 与终端表面 MUST 回退到当前内置浅色/深色主题的默认配色

## ADDED Requirements

### Requirement: Terminal Text Palette
桌面端 MUST 为浅色与深色主题分别提供一套适配的终端文字 ANSI 色板（含前景、背景与 16 个 ANSI 颜色）；主题模式或有效 scheme 变化时，终端表面 MUST 切换为对应 scheme 的色板。

#### Scenario: Terminal text follows scheme
- **WHEN** 用户把主题模式从浅色切换为深色
- **THEN** 终端表面的文字与 ANSI 颜色 MUST 切换为深色色板
