# 连接外部客户端

本文描述如何把一个已共享 Session 交给本机外部客户端操作。它假设你已经完成[首次共享 Session](../getting-started/share-a-session.md)。

## 配置 MCP 连接

在外部客户端中新增一个 MCP Server，填写桌面端设置页显示的服务地址和请求头：

```text
URL: http://127.0.0.1:4739/mcp
Authorization: Bearer <Token>
```

端口可以在「设置」→「MCP 服务」中修改；以设置页实际值为准。服务只监听本机回环地址，不接受远程网络连接。

## 绑定指定 Session

把 Share Text 整段提供给外部客户端。它包含 Session Alias、`sessionId`、连接前提和工具调用顺序，但不包含 Token。

外部客户端必须：

1. 每次调用都使用 Share Text 中的 `sessionId`。
2. 先调用 `synapse_status` 了解 Session 是否 `ready`。
3. 首次执行前调用 `synapse_observe`，取得当前输出和 `executionContextId`。
4. 只在当前 Sharing 边界内读取和操作，不猜测或切换其他 Session。

`not_ready` 表示当前 PTY environment 尚未验证。不要循环调用 `synapse_status`；等待用户完成 SSH、嵌套 Shell 或其他交互，提示符稳定后直接重新观察并提交合适的调用。

## 运行普通命令

适合不需要持续 stdin 的命令：

1. `synapse_observe` 获取 `executionContextId`。
2. 把该 ID 原样作为 `expectedContextId` 传给 `synapse_execute`。
3. 从响应取得 `transactionId`，使用 `synapse_wait` 等待完成、确认中断或不确定态。
4. 使用响应的 `nextCursor` 调用 `synapse_observe` 获取后续完整输出。

用户在 PTY 中输入内容、进入新的 Shell 环境或其他上下文变化后，旧 `executionContextId` 会失效。收到 `EXECUTION_CONTEXT_REQUIRED` 或 `EXECUTION_CONTEXT_STALE` 时，停止提交命令，重新观察后再判断。

明确会读取 stdin 的 `sudo`、`su`、`ssh`、编辑器、REPL 或菜单命令不要使用 `synapse_execute`。

## 运行交互事务

交互事务把启动、有限输入和完成确认拆开：

1. 观察并取得新的 `executionContextId`。
2. 调用 `synapse_start_interactive`，明确选择 `one_shot` 或 `bounded`。
3. 使用返回的 `transactionId` 和 `inputGrantId` 调用 `synapse_input`；每次调用都生成新的 `inputRequestId`。
4. 调用 `synapse_observe`，确认程序已经回到 Shell。
5. 把最近一次 observe 的 `nextCursor` 作为 `observedCursor` 调用 `synapse_finish_interactive`。

`synapse_wait` 在 finish 前不会自动发送完成 Probe。过早终结可能得到 `unknown`，系统不会自动重试。

## 自由输入

用户已经在 PTY 中打开交互程序或堡垒机菜单时，可以使用不绑定事务的自由模式 `synapse_input`。它必须携带当前 `expectedContextId` 和 `inputRequestId`，并且每次成功写入后都要重新 `synapse_observe`。活动交互事务期间不能使用自由输入。

自由输入不是免审批通道，也不能用来启动交互事务。文本和键名都经过白名单与大小限制；不要发送原始转义序列。

## 什么时候停止

- `SESSION_EXPIRED`：重新在桌面端 Sharing，不要重放旧事务。
- `SESSION_BUSY`：等待、终结或中断当前外部事务。
- `APPROVAL_DENIED` / `APPROVAL_TIMEOUT`：尊重用户裁决或超时，不自动重复高风险调用。
- `INPUT_WRITE_UNKNOWN` / `INTERACTIVE_START_WRITE_UNKNOWN`：不要自动重放输入或启动命令，先重新观察并让用户判断。
- `unknown`：命令可能已经执行但结果不可确认，不要自动重新提交。

工具的完整 Reference 和稳定错误码见 [MCP 工具参考](../reference/mcp-tools.md)。
