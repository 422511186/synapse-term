## MODIFIED Requirements

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
