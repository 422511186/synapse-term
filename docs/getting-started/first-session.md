# 创建第一个 Session

Session 是应用持有的本地 PTY 终端实例。它不是 SSH 连接对象，也不代表某台远程主机。

## 创建

1. 启动 Synapse Term。
2. 点击 Header 中的「+」或空工作区中的「新建终端会话」。
3. 在列表中选择应用发现的 Shell。
4. 等待 Shell 提示符出现，然后在终端中输入命令。

新 Session 默认从当前用户主目录启动。用户可以在应用设置或终端内完成 SSH、跳板机、容器、WSL 和其他认证流程。

## 管理工作区

- 使用 Session 标签切换当前 Session。
- 通过「全部会话」搜索并选择其他 Session。
- 从 Session 菜单重命名或关闭当前 Session。
- 在终端内使用滚动、查找、复制、粘贴和窗口自适应功能。

更完整的操作说明见[使用终端工作区](../guides/terminal-workspace.md)。

## 生命周期

关闭窗口只会在应用仍运行时分离 UI 订阅；重新打开窗口可以继续订阅实时输出。显式退出应用会终止全部活动 Session。Session 不跨应用重启恢复，也不提供持久化屏幕回放。

## 进入远程环境

在当前 Session 中执行 `ssh`、跳板机菜单、`docker exec`、WSL 或其他连接流程后，应用仍管理同一个本地 PTY。Synapse Term 不解析远程主机资产、凭据或连接拓扑。

## 下一步

需要外部客户端协助时，先阅读[首次共享 Session](share-a-session.md)。
