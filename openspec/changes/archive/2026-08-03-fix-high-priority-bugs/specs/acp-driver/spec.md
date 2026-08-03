# acp-driver Delta

## ADDED Requirements

### Requirement: Approval Request Entry Lifecycle
ACP 控制器维护的全局审批请求表 MUST 在审批请求达到终态时清理对应条目：`respondApproval` 成功消费后 MUST 删除该条目；会话取消、进程终止或 Agent 退出时 MUST 批量清理该会话相关的全部未决审批条目，MUST NOT 产生永不释放的累积条目。

#### Scenario: Approval is responded
- **WHEN** 用户对某 approvalId 做出批准或拒绝
- **THEN** 控制器 MUST 在消费后从全局表中删除该条目

#### Scenario: Session is cancelled or process exits
- **WHEN** 会话被取消、外部 Agent 子进程退出或被终止
- **THEN** 控制器 MUST 清理该会话下所有未决审批条目，全局表不得残留孤立条目
