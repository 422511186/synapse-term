## ADDED Requirements

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
