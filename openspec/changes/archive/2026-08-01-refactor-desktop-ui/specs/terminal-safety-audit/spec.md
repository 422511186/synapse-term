# terminal-safety-audit Specification

## ADDED Requirements

### Requirement: Prototype Permission Menu

权限控件 MUST 复刻在线原型的人工审批、自动审批 (推荐) 和完全权限 (高风险) 选项及其琥珀、蓝、红状态。选择任一项 MUST 立即更新 Header 的原型可见标签，不显示额外确认步骤。

#### Scenario: Select automatic approval
- **WHEN** 用户从权限菜单选择“自动审批 (推荐)”
- **THEN** Header MUST 显示原型的蓝色自动审批状态，且菜单关闭

#### Scenario: Select full access
- **WHEN** 用户从权限菜单选择“完全权限 (高风险)”
- **THEN** Header MUST 显示原型的红色完全权限状态，且菜单关闭

### Requirement: Runtime Audit and Approval States

Timeline 审批和 Audit MUST 使用原型的色彩、间距和状态样式，且由真实 `agent.onTimeline` 和 `audit.list` 驱动。权限选择必须作为 `agent.start` 的 `permissionMode` 传入；批准、接管和取消必须调用对应 API。状态切换 MUST 不导致页面布局跳动。

#### Scenario: Preserve an approval result while changing tabs
- **WHEN** 用户批准或接管 Timeline 审批后切换到 Audit 再返回 Timeline
- **THEN** Timeline MUST 保留来自运行时事件的批准、拒绝或接管结果
