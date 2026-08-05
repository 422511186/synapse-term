## ADDED Requirements

### Requirement: Audit Investigation Projection
审计工作区 MUST 通过稳定的结构化投影提供 Audit Trace 聚合列表和详情，不得将基础设施原始 payload 直接透传给 Renderer。聚合列表 MUST 至少包含 trace 标识、主体、Session/Task/transaction 关联、发起者、操作类别、开始/最后时间、统一 Audit Outcome、最高风险、脱敏摘要和事件数量。

#### Scenario: List audit traces for the default scope
- **WHEN** 用户打开审计主题且未设置额外筛选
- **THEN** Core MUST 返回全部保留 Session 的最近 7 天 Audit Trace，列表 MUST 按最新活动时间倒序排列，并返回可继续加载的游标

#### Scenario: Open an audit trace detail
- **WHEN** 用户点击表格中的一条 Audit Trace
- **THEN** 系统 MUST 打开独立的只读详情弹窗，不得将详情追加到表格底部或改变列表布局；详情事件 MUST 按发生时间正序排列，并包含原始事件类型、主体、策略/审批、风险、退出码、原因和稳定关联 ID

### Requirement: Audit Trace Correlation
审计聚合 MUST 使用已有领域标识，不得伪造外部 Agent Task 或引入新的跨 MCP/ACP/Core trace ID：内置 Agent 事件 MUST 按 `taskId` 聚合，外部终端命令事件 MUST 按 payload 中的 `transactionId` 聚合，没有这些关联的事件 MUST 独立展示。

#### Scenario: Correlate an Agent Task
- **WHEN** 多条审计事件具有相同的内置 Agent `taskId`
- **THEN** 系统 MUST 将它们展示为同一条 Audit Trace，并在详情中按时间展示任务、审批和命令事件

#### Scenario: Correlate an external command transaction
- **WHEN** `external.command`、`external.wait` 或 `external.interrupt` 事件具有相同的 `transactionId`
- **THEN** 系统 MUST 将这些事件展示为同一条外部 Audit Trace，且 MUST 不为其伪造 Task/Turn 关联

#### Scenario: Display an uncorrelated event
- **WHEN** Provider、Session、观察或拒绝事件没有 `taskId` 或 `transactionId`
- **THEN** 系统 MUST 将该事件作为独立 Audit Trace 展示，不得根据时间或 Session 猜测关联关系

### Requirement: Audit Query Controls
审计查询 MUST 支持时间范围、Session、发起者、操作类别、Audit Outcome、风险等级、脱敏关键词、是否包含成功观察和游标分页。关键词 MUST 只匹配脱敏摘要、原因、Session 标识和关联 ID；查询结果 MUST 有界。

#### Scenario: Filter audit traces
- **WHEN** 用户在主搜索栏输入关键词，或打开“筛选”弹窗选择 Session、发起者、类别、结果、风险、自定义时间或“包含成功观察”
- **THEN** 系统 MUST 只返回满足全部已选条件的 Audit Trace；应用筛选后 MUST 回到第一页，并在搜索区域展示可移除的已启用条件标签

#### Scenario: Paginate audit traces
- **WHEN** 用户点击上一页或下一页
- **THEN** 系统 MUST 使用已有游标加载有界的相邻页面，每页最多 25 条，不得一次性把全部保留事件发送给 Renderer

#### Scenario: Include successful observations
- **WHEN** 用户启用“包含观察事件”筛选
- **THEN** 系统 MUST 将成功的 `external.observe`、成功的 `external.status`、成功的 `session.probe` 和成功的资源观察纳入可查询结果

### Requirement: Normalized Audit Outcome
每条 Audit Trace MUST 提供统一结果：`in_progress`、`success`、`failure`、`rejected`、`interrupted` 或 `information`。统一结果 MUST 从关联事件推导，详情 MUST 保留具体事件类型和原因。

#### Scenario: Show a successful trace
- **WHEN** Trace 具有正常完成的任务或命令终态
- **THEN** 列表 MUST 将其 Audit Outcome 标记为 `success`

#### Scenario: Show a rejected trace
- **WHEN** Trace 因策略拒绝、审批拒绝或外部审批配置被拒绝而结束
- **THEN** 列表 MUST 将其 Audit Outcome 标记为 `rejected`，详情 MUST 展示稳定拒绝原因

#### Scenario: Show a failed or interrupted trace
- **WHEN** Trace 发生执行错误、非零退出、Shell 丢失、协议错误、用户取消、接管或主动中断
- **THEN** 系统 MUST 分别归类为 `failure` 或 `interrupted`，不得显示为成功

### Requirement: Redacted Audit Details
命令或路径的可读摘要 MUST 在写入长期审计前经过现有 SecretRedactor；命令哈希、风险、授权、退出码和原因 MUST 保留用于完整性和诊断。审计详情 MUST 不包含 Protected Input、未脱敏秘密、完整终端输出或终端录像。

#### Scenario: Store a redacted command preview
- **WHEN** Agent 或外部调用完成一条可审计命令
- **THEN** 审计 MUST 保存脱敏的 command preview 和命令哈希，且不得保存命令中被识别的秘密明文

#### Scenario: Redactor fails closed
- **WHEN** 命令、路径或原因的脱敏过程无法确认安全
- **THEN** 审计投影 MUST 使用安全占位符或省略该摘要，且 MUST 不向 Renderer 暴露原始值

#### Scenario: Render a legacy event without a preview
- **WHEN** 历史事件没有 command preview 或路径摘要
- **THEN** 详情 MUST 使用可用的事件类型、哈希或原因降级展示，不得推测或伪造原始命令

### Requirement: Audit Observation Noise
成功的只读观察 MUST 默认从审计主列表隐藏，但底层事件 MUST 保留并可通过显式观察筛选查询；观察失败 MUST 默认可见。

#### Scenario: Hide successful observations by default
- **WHEN** 用户打开审计主题且未启用“包含观察事件”
- **THEN** 成功的 `external.observe`、`external.status`、`session.probe` 和资源观察 MUST 不出现在主列表中

#### Scenario: Keep failed observations visible
- **WHEN** 资源刷新、Session Probe 或外部观察失败
- **THEN** 失败事件 MUST 出现在默认审计结果中，并提供失败原因

### Requirement: Audit Workspace Refresh
审计主题 MUST 在可见期间以有界轮询自动刷新当前查询，并保留筛选、搜索和已选详情；离开审计主题后 MUST 停止轮询。第一版轮询间隔 MUST 为 5 秒，并 MUST 保留手动刷新入口。

#### Scenario: Refresh an open audit query
- **WHEN** 审计主题保持可见且达到一次 5 秒刷新周期
- **THEN** 系统 MUST 使用当前查询条件加载最新结果，不得清空用户筛选或已选 Audit Trace

#### Scenario: Leave the audit topic
- **WHEN** 用户切换到其他 Settings Topic 或返回工作区
- **THEN** 系统 MUST 停止审计轮询，不得继续发起后台审计查询

### Requirement: Controlled Audit Retention Cleanup
审计主题 MUST 在页头提供“保留策略”入口；保留期限和仅清理过期数据的操作 MUST 在独立弹窗中展示。系统 MUST 不提供清空全部审计、按筛选删除未过期记录、第一版任意保留期编辑或审计导出。

#### Scenario: Review retention policy
- **WHEN** 用户点击审计页右上角的“保留策略”按钮
- **THEN** 系统 MUST 打开保留策略弹窗，并展示审计记录和原始终端日志的当前保留期限；列表页不得常驻展示清理按钮

#### Scenario: Confirm expired-data cleanup
- **WHEN** 用户在保留策略弹窗中点击清理，并在确认对话框中确认
- **THEN** 系统 MUST 调用现有 `audit.cleanup`，只清理已过期数据，并在保留策略弹窗中展示清理的 raw logs 与 audit events 数量

#### Scenario: Cancel cleanup
- **WHEN** 用户关闭或取消清理确认对话框
- **THEN** 系统 MUST 不调用清理 API，也不得修改任何审计记录
