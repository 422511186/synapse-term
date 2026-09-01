# theme-customization Specification

## Purpose
提供桌面端外观主题能力：用户可在浅色、深色与跟随系统三种模式间切换，并可自定义背景、前景与强调色三组核心配色；系统将这些设置持久化并应用到桌面 UI 与终端表面。

## Requirements

### Requirement: Theme Mode Selection
桌面端 MUST 提供主题模式设置，取值 MUST 为 `light`、`dark` 或 `system` 三者之一；未设置或配置损坏时 MUST 回退 `system`。模式为 `system` 时，系统 MUST 依据操作系统外观决定有效深浅（有效 scheme）。

#### Scenario: Choose a fixed theme mode
- **WHEN** 用户把主题模式从 `system` 改为 `light`
- **THEN** 桌面 UI 与终端表面 MUST 切换为浅色配色，且不随操作系统外观变化
- **AND** 用户随后改为 `dark` 时，界面 MUST 切换为深色配色

#### Scenario: Follow the operating system scheme
- **WHEN** 主题模式为 `system` 且操作系统外观为深色
- **THEN** 有效 scheme MUST 为 `dark`；操作系统外观切换为浅色后，界面 MUST 跟随切换为浅色，无需重启应用

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

### Requirement: Theme Persistence
主题设置（模式与自定义配色）MUST 与通用设置一同持久化到本地设置文件；应用重启后 MUST 恢复用户所选的主题模式与自定义配色。设置文件缺失或字段损坏时 MUST 回退默认值而不崩溃。

#### Scenario: Restore theme after restart
- **WHEN** 应用重启且本地设置文件中存在已保存的主题模式与自定义配色
- **THEN** 应用启动后 MUST 立即以该模式与配色渲染界面

### Requirement: Theme State Notification
桌面端 MUST 在主题设置变更或操作系统外观变化时，向 Renderer 推送最新的主题状态（含模式、有效 scheme 与自定义配色）；Renderer MUST 依据该状态更新界面，且 MUST 只通过受限 preload API 获取主题状态，不得直接访问设置文件或系统外观 API。

#### Scenario: Notify on scheme change
- **WHEN** 主题模式为 `system` 且操作系统外观发生变化
- **THEN** 系统 MUST 推送新的主题状态，Renderer 界面 MUST 无需用户操作即更新配色

### Requirement: Terminal Text Palette
桌面端 MUST 为浅色与深色主题分别提供一套适配的终端文字 ANSI 色板（含前景、背景与 16 个 ANSI 颜色）；主题模式或有效 scheme 变化时，终端表面 MUST 切换为对应 scheme 的色板。

#### Scenario: Terminal text follows scheme
- **WHEN** 用户把主题模式从浅色切换为深色
- **THEN** 终端表面的文字与 ANSI 颜色 MUST 切换为深色色板

### Requirement: Scheme-aware Semantic UI Palette
桌面 UI MUST 根据当前有效 scheme 使用一套完整的语义颜色角色，至少覆盖主要文字、辅助文字、禁用文字、卡片/控件表面、边框、焦点、信息、成功、警告和危险状态；内置浅色与深色 scheme 的正常文字与背景对比度 MUST 至少为 4.5:1，非文字控件边界与焦点指示 MUST 至少为 3:1。组件不得依赖只在另一种 scheme 下可读的状态色。

#### Scenario: Built-in light palette passes readability checks
- **WHEN** 当前有效 scheme 为 `light` 且未启用自定义配色
- **THEN** 设置工作区、审批卡片、外部执行状态栏和其他桌面 UI 的文字与状态控件 MUST 使用浅色 scheme 的语义颜色，并满足规定的对比度

#### Scenario: Built-in dark palette keeps readable states
- **WHEN** 当前有效 scheme 为 `dark` 且未启用自定义配色
- **THEN** 同一批桌面 UI MUST 使用深色 scheme 的语义颜色，现有可读性和状态区分不得回归

### Requirement: Custom Palette Contrast Feedback
当用户启用自定义核心配色并编辑背景、前景或强调色时，设置界面 MUST 评估受影响的文字与控件组合。若组合低于规定的对比度，界面 MUST 显示明确的可读性警告，并对受影响的桌面 UI 文字或控件使用当前有效 scheme 的安全回退颜色，直至组合满足要求；系统 MUST 保留用户输入的合法颜色值供用户继续编辑，不得静默改写或删除该值。

#### Scenario: Warn and fall back for a low-contrast custom pair
- **WHEN** 用户启用自定义配色并设置出低于 4.5:1 的背景/前景组合或低于 3:1 的控件/焦点组合
- **THEN** 设置区显示可读性警告，受影响的桌面 UI 使用安全回退颜色，且自定义颜色值仍可被用户修正

#### Scenario: Apply a readable custom pair
- **WHEN** 用户将自定义背景、前景和强调色调整为满足对比度要求的组合
- **THEN** 警告消失，桌面 UI 应用对应的自定义颜色，其他未自定义的语义角色继续沿用当前 scheme
