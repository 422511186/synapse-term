# MCP 工具参考

内嵌 MCP Server 只提供八个 `synapse_*` 工具。每次调用都必须携带当前 Sharing 提供的 `sessionId`；外部客户端不能枚举或猜测其他 Session。

## 调用前提

- MCP 服务已在桌面端启用，连接使用设置页显示的回环 URL 和 Bearer Token。
- Session 仍处于 Sharing，且 PTY 正在运行。
- 首次执行或交互启动前，先调用 `synapse_observe` 获取 `executionContextId`。
- 结构化命令和交互事务只能在当前 Session 没有其他外部事务时提交。

## 工具总览

| 工具 | 用途 | 是否写入 PTY |
| --- | --- | --- |
| `synapse_status` | 读取 Session 就绪快照 | 否 |
| `synapse_observe` | 读取 Sharing 边界内的输出历史分页 | 否 |
| `synapse_execute` | 提交带完成 Probe 的结构化命令 | 是 |
| `synapse_wait` | 等待事务快照或终态 | 否 |
| `synapse_interrupt` | 向事务所属 PTY 发送中断 | 是 |
| `synapse_start_interactive` | 启动不附加 Probe 的交互事务 | 是 |
| `synapse_input` | 发送事务内或自由模式的受限输入 | 是 |
| `synapse_finish_interactive` | 在调用方确认回到 Shell 后发送完成 Probe | 是 |

## `synapse_status`

输入：`sessionId`。

返回的主要字段：

- `status`：`ready`、`not_ready` 或 `expired`；
- `environment`：已验证的 `dialect`（`posix`、`powershell`、`unknown`）、`platform`（`unix`、`windows`、`unknown`）和 `verificationStatus`；
- `readinessReason`、`guidance`：只描述本地 PTY environment 就绪事实；
- `activeTransactionId`、`activeTransactionKind`：存在活动外部事务时返回。

这是只读快照，不触发 Probe。`not_ready` 时不要循环调用；等待提示符稳定后直接观察并提交合适的入口。

## `synapse_observe`

输入：

- `sessionId`；
- 可选 `afterCursor`：使用上一次响应的 `nextCursor` 从其后读取；
- 可选 `tail: true`：读取最近一页，不能和 `afterCursor` 同时使用；
- 可选 `maxBytes`：本页 `1` 到 `65536` 字节，服务端仍执行硬上限。

返回的主要字段：`output`、`redacted`、`nextCursor`、`hasMore`、`historyTruncated`、`earliestCursor`、`executionContextId`，以及活动事务信息。

读取不会消费历史。`historyTruncated` 为真时，省略 `afterCursor` 重新读取并使用返回的 `earliestCursor` 建立新的分页起点。输出是清理、脱敏后的文本，不是屏幕快照或原始 PTY 字节流。

## `synapse_execute`

输入：`sessionId`、完整原文 `command`、最近 observe 返回的 `expectedContextId`，以及可选的 `observationWindowMs`（`1` 到 `60000` 毫秒）。

该工具适合不需要持续 stdin 的命令。服务会先验证当前 PTY environment、风险和审批，再写入 command，并独立发送完成 Probe。返回包含 `transaction`、`status`、有限即时 `output`、`outputRange`、`nextCursor`、`executionContextId`、`completion`、`retryable` 和 `safeToResubmit` 等字段。

明确会读取 stdin 的命令必须使用 `synapse_start_interactive`。若上下文在 Probe 或审批等待期间变化，command 在写入前失效。

## `synapse_start_interactive`

输入：`sessionId`、完整原文 `command`、`expectedContextId`、`inputGrantMode`（`one_shot` 或 `bounded`）。

该工具只写入 command 和终止回车，不附加完成 Probe。成功返回 `transactionId`、`inputGrantId`、`inputGrantMode`、`status`、输出窗口和当前上下文信息。

- `one_shot`：一次输入授权；
- `bounded`：有界多次输入授权，最多 256 次、总计 256 KiB，空闲 10 分钟后失效；单次输入仍受 8 KiB 文本、128 个键和 16 KiB payload 限制。

启动写入交付不确定时返回 `INTERACTIVE_START_WRITE_UNKNOWN`，不返回可操作的事务或授权句柄，不得自动重试。

## `synapse_input`

每次调用都必须提供 `sessionId`、调用方生成的 `inputRequestId`，以及 `text` 或 `keys` 至少一个。

两种互斥模式：

| 模式 | 必填字段 | 适用场景 |
| --- | --- | --- |
| 事务内输入 | `transactionId` + `inputGrantId` | 推进当前交互事务的 stdin |
| 自由输入 | `expectedContextId` | 驱动用户已经打开的交互程序或菜单 |

`keys` 只能使用固定 normal-mode 键名：`up`、`down`、`left`、`right`、`enter`、`esc`、`tab`、`backspace`、`delete`、`home`、`end`、`pageup`、`pagedown`、`space`、`f1` 至 `f12`。不接受原始转义序列。

服务只返回发送元数据、有限输出、游标和必要的上下文信息，不回显 `text` 原文。`inputRequestId` 用于同一逻辑输入的网络重试去重；payload、模式或授权 ID 不一致时不能复用该 ID。收到 `INPUT_WRITE_UNKNOWN` 时，也不能通过换一个新 ID 自动重放。自由输入成功后会轮换 `executionContextId`，下一次输入前要重新 observe。

## `synapse_finish_interactive`

输入：`sessionId`、`transactionId`、最近一次 `synapse_observe` 返回的 `observedCursor`（即 `nextCursor`）。

调用方必须先观察到程序回到 Shell。服务随后独立发送完成 Probe，并返回交互事务终态和完成信息。过早调用可能进入 `unknown`，不会自动重试。

## `synapse_wait`

输入：`sessionId`、`transactionId`，可选 `timeoutMs`（`0` 到 `60000` 毫秒，默认 30 秒）。

单次等待超时只返回当前快照，不改变事务状态。结构化事务必须继续等待、观察或中断；交互事务在 finish 前保持 `running`，不会自动注入 Probe。

## `synapse_interrupt`

输入：`sessionId`、`transactionId`。

工具向当前事务所属 PTY 发送中断，并返回 `interrupted`、`status`、`kind`、`retryable` 和 `safeToResubmit`（可用时）。它不承诺远程进程或进程组已经终止。

## 事务状态

- `running`：尚未取得可验证完成证据；
- `completed`：已取得完成证据，非零退出码仍属于 completed；
- `interrupted`：本地 PTY 中断按事务语义收敛；
- `unknown`：可能已经执行，但结果无法可靠确认；不要自动重新提交。

## 稳定错误码

| 错误码 | 含义与处理 |
| --- | --- |
| `AUTHORIZATION_REVOKED` | Token 已吊销；在桌面端生成新 Token 并重建连接。 |
| `SESSION_EXPIRED` | Session 退出、取消 Sharing 或服务清理；重新 Sharing。 |
| `SESSION_NOT_READY` | 当前 PTY environment 尚未准备好；等待提示符稳定后重新观察。 |
| `SESSION_BUSY` | 已有外部事务或审批中的调用；等待、终结或中断当前事务。 |
| `TRANSACTION_NOT_FOUND` | 事务不存在、已结束或句柄不属于当前 Session。 |
| `POLICY_DENIED` | 审批模式或输入组合不允许该调用。 |
| `SHELL_MISMATCH` | command 与已验证 Shell 方言不匹配。 |
| `COMMAND_NOT_AUDITABLE` | command 或输入未通过原文、大小或协议校验，未写入。 |
| `INTERACTIVE_COMMAND_UNSUPPORTED` | 结构化入口识别到交互命令；改用交互事务。 |
| `EXECUTION_CONTEXT_REQUIRED` | 缺少当前上下文；先 observe。 |
| `EXECUTION_CONTEXT_STALE` | 上下文已变化；先 observe，不能继续使用旧批准或旧 Probe。 |
| `OUTPUT_CURSOR_STALE` | 游标不在当前保留窗口或不是最近 observe 的游标；重新分页。 |
| `APPROVAL_TIMEOUT` | 审批卡片超时，视为拒绝。 |
| `APPROVAL_DENIED` | 用户拒绝调用。 |
| `INPUT_GRANT_EXHAUSTED` | 输入授权已耗尽或结构化事务没有输入授权。 |
| `INPUT_WRITE_UNKNOWN` | 自由输入交付结果不确定；不要自动重放。 |
| `INTERACTIVE_START_WRITE_UNKNOWN` | 交互启动写入交付结果不确定；不要自动重试，先重新观察。 |

安全语义、Sharing 输出边界和审批原因见[安全模型](../concepts/security-model.md)及对应 ADR。
