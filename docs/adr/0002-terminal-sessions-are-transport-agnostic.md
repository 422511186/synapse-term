# ADR-0002：Session 与连接拓扑无关

状态：已实现

## 决策

系统建模的是已经准备好的终端环境，而不是 SSH 连接、服务器、跳板机或容器对象。用户先在终端内完成连接，应用继续管理同一个本地 PTY。

## 当前实现

当前 `SessionState` 只记录 PTY 状态与终端元数据；稳定语义见[Session 与 Sharing](../concepts/session-and-sharing.md)和[架构说明](../architecture/architecture.md)。

## 影响

产品不提供主机资产枚举、远端凭据管理或连接拓扑恢复。进入 SSH、容器或 WSL 后，应用不解析连接拓扑。
