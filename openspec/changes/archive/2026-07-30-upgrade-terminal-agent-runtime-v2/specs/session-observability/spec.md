## ADDED Requirements

### Requirement: Explicit Read-Only Resource Snapshot
系统 MUST 仅在用户显式请求刷新且当前 Terminal Session 可安全执行时，通过固定只读命令采集 Session Resource Snapshot，不得创建 SSH、堡垒机、容器或服务器资产对象。

#### Scenario: Refresh after SSH connection
- **WHEN** 用户已在 Terminal Session 中进入远端环境、设置正确 execution dialect 并点击刷新资源
- **THEN** Core 在同一 Session 中执行只读采集并返回该远端环境的资源快照

#### Scenario: Session is waiting for interactive input
- **WHEN** Shell 处于密码提示、TUI、活动命令或 `interaction_required`
- **THEN** 资源刷新被拒绝且不得向 PTY 写入采集命令

### Requirement: Bounded Cross-Dialect Metrics
资源服务 MUST 为 POSIX 与 PowerShell 使用独立、有界命令和解析器，并 SHALL 返回主机、OS、uptime、CPU/负载、内存、交换分区、磁盘和网络中可确认的字段。

#### Scenario: A metric command is unavailable
- **WHEN** 目标环境缺少某个可选网络或 CPU 命令
- **THEN** 快照保留其他已确认字段并把该指标标为不可用，不得伪造零值

### Requirement: Resource Snapshot Audit
每次资源刷新 MUST 记录 Session、方言、开始时间、完成状态、采集字段和只读策略结果，且不得长期保存完整原始终端输出。

#### Scenario: Inspect read-only verification evidence
- **WHEN** 发布验证查询 `example-host` 资源刷新审计
- **THEN** 审计证明只执行固定只读命令且没有 mutating、privileged 或 destructive 操作
