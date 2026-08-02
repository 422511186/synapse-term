# ADR-0009：Terminal Session 不跨 Core 重启存活

状态：已实现

## 决策

Core 崩溃、升级、显式终止或系统重启后不承诺恢复旧 PTY、Shell 进程或远端连接。系统只恢复可持久化的元数据、对话历史和审计，并把旧实时会话标记为 `interrupted`。

## 当前实现

`SessionRecovery` 在 Core 启动时处理未完成状态；`CoreLifecycle` 的 `terminate_all` 结束活动 Session。SQLite 迁移和备份独立于 PTY 生命周期。

## 影响

升级前应结束活动 Session。自动重连和跨进程 PTY 接管属于未来可靠性需求，不应由当前文档暗示已支持。
