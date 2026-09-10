# Session 与 Sharing

## Session

Session 是 Synapse Term 持有的本地 PTY 实例，拥有独立生命周期和实时输出。它描述“当前终端环境”，不描述 SSH 连接、服务器、容器或其他远程资产。

因此，用户在 Session 中执行 SSH、跳板机、容器或 WSL 后，仍然是同一个 Session。应用不会解析连接拓扑，也不会在重启后恢复远程状态。

## Sharing

Sharing 是用户把一个 Session 显式开放给外部客户端的动作。共享范围由具体 Session ID 绑定：

- 未 Sharing 的 Session 对外部客户端不存在；
- 外部客户端不能枚举 Session 或通过猜测切换目标；
- 取消 Sharing、Session 退出、Token 吊销或应用退出都会使访问失效；
- 重新 Sharing 会建立新的 Sharing 输出边界和新的运行期句柄。

Sharing 不是远程端点，也不是永久授权。内嵌 MCP Server 只监听本机回环地址，外部客户端必须使用用户提供的 Share Text 和连接凭据。

## 输出边界

输出历史从 Sharing 建立的时刻开始，保存于当前应用运行期的有限窗口，并在对外提供前完成协议帧清理和敏感信息脱敏。读取通过输出游标分页，不会消费历史。

这意味着外部客户端不能回放 Sharing 之前的终端内容，也不能获得屏幕快照、原始 PTY 字节流或跨重启历史。

## 为什么分开

把 Session 与 Sharing 分开，可以同时保留本地用户对 PTY 的控制权和明确的外部授权边界。外部客户端获得的是一个被用户选择的实时能力，而不是应用内所有终端的远程镜像。
