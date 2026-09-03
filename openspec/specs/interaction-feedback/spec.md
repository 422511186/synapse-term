# interaction-feedback Specification

## Purpose
规定桌面端统一的交互反馈机制：异步按钮三态、防连点/防抖与破坏性操作确认。

## Requirements

### Requirement: Async Action Button States
所有有界异步操作按钮 MUST 具备明确的状态反馈：待命态显示操作名称；进行中态 MUST 禁用按钮、显示进行中文案并设置 `aria-busy`；完成后 MUST 恢复待命态或显示失败原因。操作进行中 MUST 忽略同一按钮的重复点击。

#### Scenario: Destructive confirm is pending
- **WHEN** 用户确认执行删除或关闭操作
- **THEN** 确认按钮 MUST 立即切换为进行中文案并禁用，重复点击 MUST 被忽略

#### Scenario: Operation succeeds
- **WHEN** 异步操作成功返回
- **THEN** 按钮 MUST 恢复待命态，操作结果通过界面状态反映

#### Scenario: Operation fails
- **WHEN** 异步操作抛出错误
- **THEN** 按钮 MUST 恢复待命态，并展示可识别的错误信息

### Requirement: Action Debounce and Double-Click Protection
桌面端所有触发异步操作的用户控件 MUST 采用 leading-edge 防连点：首次点击立即生效，请求未 settle 前忽略该控件的后续点击；请求完成后 MUST 恢复可点，且同一时刻每个控件最多允许一个未 settle 的请求。

#### Scenario: Rapid repeated click on a destructive action
- **WHEN** 用户在确认按钮上快速连续点击
- **THEN** 系统 MUST 只发起一次操作请求

### Requirement: Confirmation for Destructive Operations
关闭终端会话、批量关闭终端等破坏性操作 MUST 在执行前展示确认对话框，明确说明后果；确认对话框的面板、页眉、页脚、正文和操作文字 MUST 使用当前有效 scheme 的语义表面与文字配对，MUST NOT 依赖只匹配单一 scheme 的硬编码表面颜色；确认按钮 MUST 显示 pending 态并防连点，取消或关闭对话框 MUST 不执行操作。

#### Scenario: Close terminal requires confirmation
- **WHEN** 用户关闭单个或全部终端会话
- **THEN** 系统 MUST 先展示确认对话框，用户确认后才执行关闭，确认期间按钮显示 pending 态

#### Scenario: Cancel confirmation keeps session
- **WHEN** 用户在确认对话框点击取消或关闭
- **THEN** 系统 MUST NOT 终止任何 Session

#### Scenario: Confirmation dialog follows the active scheme
- **WHEN** 当前有效 scheme 为 `light` 或 `dark`，用户触发关闭单个、全部或左右范围的终端会话
- **THEN** 确认对话框的标题、正文、取消与关闭按钮 MUST 使用对应 scheme 的语义颜色，并保持不低于 4.5:1 的文字对比度

#### Scenario: Light scheme does not reuse dark-only surfaces
- **WHEN** 当前有效 scheme 为 `light`
- **THEN** 确认对话框 MUST NOT 呈现只在深色表面可读的文字或控件组合
