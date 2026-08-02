## MODIFIED Requirements

### Requirement: Approval and Takeover Controls

桌面端 MUST 提供命令批准、拒绝、Agent 取消、命令中断和 User Takeover 的明确独立控件。Approval 卡片 MUST 以唯一 approval id 显示生命周期；完成、取消、过期、任务结束或环境失效后不得继续显示可操作的批准按钮。

#### Scenario: Review a mutating command

- **WHEN** Agent 请求执行需要授权的命令
- **THEN** UI 显示完整命令、目标 Session、目的和风险，并允许用户批准或拒绝

#### Scenario: Approval completes or becomes stale

- **WHEN** Core 发出 approval completed、cancelled 或 invalidated 事件
- **THEN** UI 更新同一个 approval 卡片并隐藏批准/拒绝操作，不创建与 Tool 卡片重复的 actionable 卡片

#### Scenario: Resolved approval does not duplicate the tool card

- **WHEN** approval 已完成、取消或因环境失效，且对应 Tool 调用已经显示执行状态或结果
- **THEN** UI 保留 approval id 的状态合并能力，但不再渲染独立的终态 Approval 卡片；执行信息只通过 Tool 卡片展示

#### Scenario: Take over an interactive terminal

- **WHEN** Command Transaction 进入 `interaction_required`
- **THEN** UI 显示接管状态并允许用户获得输入控制权

## ADDED Requirements

### Requirement: Cancellation Remains Available During Agent Blocking States

桌面端 MUST 在 Agent 等待审批、环境 Probe、Provider 输出或 Tool Result 时保持取消任务控件可用；显示可恢复错误时不得用全屏遮罩阻断取消操作，除非用户明确关闭该提示后继续。

#### Scenario: Cancel from approval waiting state

- **WHEN** Timeline 显示待审批卡片且用户点击取消任务
- **THEN** 请求发送到当前 Session 的活动 Agent Task，Core 返回 cancelled，UI 清除 active turn 和待审批操作

#### Scenario: Stale approval error is shown

- **WHEN** 用户点击旧审批导致 `approval_invalid` 或 `Approval is no longer pending`
- **THEN** UI 刷新当前 Agent 状态并将旧卡片置为不可操作，取消任务仍可点击且不会被错误弹层永久遮挡
