# ADR-0021：MCP Server 内嵌在桌面应用

状态：已实现

## 决策

当前 MCP Server 是 Electron Main 的可选能力，不单独拆成独立服务进程。桌面端必须运行，端点默认关闭并只监听本机回环地址。

## 当前实现

`McpController` 持有 `userData/mcp/settings.json`、开关、审批模式和 token；`EmbeddedMcpServer` 监听随机端口的 `/mcp`，使用 Streamable HTTP 和 Bearer token。

## 影响

用户关闭桌面应用或 MCP 开关后端点停止。独立 Core/MCP 服务属于未来评估，不应由当前连接字符串推断为远程服务。
