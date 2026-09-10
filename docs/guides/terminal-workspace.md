# 使用终端工作区

## Session 操作

应用工作区围绕多个 Session 组织。每个 Session 有独立的 PTY 和生命周期：

- 「+」创建新 Session，并从系统发现的 Shell 中选择启动环境。
- 标签切换当前 Session；「全部会话」用于搜索和快速选择。
- Session 菜单可重命名、共享到 MCP 或关闭 Session。
- 关闭 Session 会终止其 PTY；关闭应用窗口与显式退出应用的行为见[创建第一个 Session](../getting-started/first-session.md)。

## 终端内容

终端支持滚动、查找、复制、粘贴和窗口自适应。终端输出是当前 Session 的实时视图，不是可跨重启恢复的日志。

## Shell 和远程命令

Shell 由本机环境发现。用户可以在同一个 Session 中完成：

- SSH 或跳板机登录；
- 容器或 WSL 进入；
- 需要持续 stdin 的程序和菜单操作。

进入这些环境后，应用仍只看到一个本地 PTY，不会创建远程主机对象或恢复连接拓扑。外部客户端的执行前提以运行时 Probe 和最近一次输出观察为准，不能只根据启动时的 Shell 提示判断环境。

## 与外部客户端协作

只有用户主动 Sharing 的 Session 才能被外部客户端使用。Sharing 不会自动枚举其他 Session，也不是远程端点。需要配置时，按[连接外部客户端](connect-external-client.md)操作。
