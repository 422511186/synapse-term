# 首次共享 Session

Sharing 是用户把一个指定 Session 显式开放给外部客户端的动作。未共享的 Session 对外部客户端不存在。

## 前置条件

- 已创建并运行一个 Session。
- 已准备好要使用的外部客户端，例如 Codex。
- 知道外部客户端会收到操作权限；不要共享包含不应被读取或写入内容的 Session。

## 操作步骤

1. 打开「设置」→「MCP 服务」，启用内嵌 MCP Server。
2. 在设置页复制服务地址和 `Authorization: Bearer <Token>` 请求头。默认地址是 `http://127.0.0.1:4739/mcp`，端口可以修改。
3. 在目标 Session 的操作菜单选择「共享到 MCP」。
4. 将对话框生成的 Share Text 连同服务地址和请求头提供给外部客户端。
5. 外部客户端应先调用 `synapse_status`，再调用 `synapse_observe` 获取当前输出和 `executionContextId`。

Share Text 不包含 Token。不要把 Token 放进 URL、`sessionId`、`command` 或公开对话中；只将它作为 MCP 连接的 Authorization 请求头配置。

## 外部客户端的最短路径

- 普通命令：`synapse_observe` → `synapse_execute` → `synapse_wait`。
- 需要 stdin 的程序：`synapse_observe` → `synapse_start_interactive` → `synapse_input` / `synapse_observe` → `synapse_finish_interactive`。
- 读取较长输出：重复使用 `synapse_observe` 返回的 `nextCursor` 作为 `afterCursor`。

完整参数、字段和错误码见 [MCP 工具参考](../reference/mcp-tools.md)；连接配置和停手条件见[连接外部客户端](../guides/connect-external-client.md)。

## 取消共享

在「设置」→「MCP 服务」的共享列表中取消目标 Session 的 Sharing。取消后，当前外部事务、审批和输出历史都会失效；重新 Sharing 会建立新的输出边界，不回放之前的内容。

Token 吊销、MCP 服务关闭、Session 退出或应用退出也会使外部访问失效。
