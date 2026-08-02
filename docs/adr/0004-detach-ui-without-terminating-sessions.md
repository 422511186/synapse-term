# ADR-0004：UI 脱离不等于终止 Session

状态：已实现

## 决策

Session 有独立的 `attached | detached` 状态。Core 支持 `keep_background` 关闭语义，允许桌面 UI 脱离而不立即结束 PTY；`terminate_all` 才会结束当前 Session。

## 当前实现

`SessionActor` 提供 attach/detach，`CoreLifecycle` 和 `CoreSupervisor` 提供两种关闭模式。桌面应用正常退出路径当前使用 `terminate_all`，用户可通过 Core 操作菜单选择保留后台 Core。

## 影响

UI 重连需要 replay 和状态同步；后台保活不是跨 Core 崩溃或系统重启的持久化承诺。
