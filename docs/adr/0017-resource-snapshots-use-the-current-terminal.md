# ADR-0017：资源快照使用当前 Terminal Session

状态：已实现

## 决策

资源信息只在用户显式刷新后，通过当前就绪 Session 的固定只读命令采集。产品不建立 SSH 主机资产模型，也不在后台轮询未知环境。

## 当前实现

`SessionResourceService` 根据 POSIX 或 PowerShell 方言选择采集命令和解析器，返回 host、OS、uptime、CPU、内存、swap、磁盘和网络的结构化快照。

## 影响

同一面板可观察本地 Shell、SSH、跳板机后的 Shell 或容器，但结果只代表刷新时的当前环境，部分命令不可用时状态为 `partial` 或 `unavailable`。
