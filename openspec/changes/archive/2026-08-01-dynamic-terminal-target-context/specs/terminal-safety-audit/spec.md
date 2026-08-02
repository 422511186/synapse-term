## MODIFIED Requirements

### Requirement: Exact Command Approval

Approval Grant MUST 绑定一个 Session、Agent Task、顺序、完整命令文本和批准时的 environment capability epoch；任何编辑、插入、重排、目标改变或 environment epoch 改变都会使 Grant 失效。

#### Scenario: Approved command is edited

- **WHEN** Agent 或 UI 在授权后改变命令中的任何字符
- **THEN** Core 拒绝执行并要求新的 Approval Grant

#### Scenario: Execute exact approved list

- **WHEN** 待执行命令序列与有效 Grant 的命令、风险和 environment epoch 完全匹配
- **THEN** Core 可按批准顺序执行并记录 Grant ID

#### Scenario: Target environment changes after approval

- **WHEN** 用户在审批等待期间通过 SSH、容器或人工输入改变当前 PTY environment
- **THEN** Core 使旧 Grant 失效、取消旧审批卡片并要求重新 Probe；旧审批不能恢复模型或执行命令

## ADDED Requirements

### Requirement: Stale Approval Is Not Actionable

Core 和 Desktop MUST 将 completed、cancelled、expired、environment-invalidated 或 task-cancelled 的 Approval 标记为不可操作；重复提交旧 approval id MUST 不产生终端副作用。

#### Scenario: User clicks an old approval

- **WHEN** 用户点击已经完成、取消或被新环境替代的旧审批卡片
- **THEN** Core 拒绝或幂等忽略该请求，不能恢复旧 Runtime、重复执行命令或创建新的审批循环

#### Scenario: Approval request is audited

- **WHEN** 审批因环境 epoch、任务状态或 approval id 失效而被拒绝
- **THEN** 审计记录稳定拒绝原因和关联的 task/tool/epoch，且不记录成功执行结果
