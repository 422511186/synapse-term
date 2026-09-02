# ADR-0017：MCP Sharing 边界内的 PTY 输出历史

状态：已接受

## 决策

内嵌 MCP Server 向外部客户端提供的是当前 Sharing 边界内的 PTY 输出历史，而不是终端屏幕快照或原始 PTY 字节流。

### Session 状态

- `synapse_status` 保持 `ready`、`not_ready`、`expired` 三种顶层状态。
- `readinessReason` 只描述本地 PTY 生命周期、当前 PTY 环境验证和用户接管事实，不返回主机、传输方式、SSH 层级或连接拓扑。
- `environment` 只包含已验证的方言、平台和验证状态；`synapse_status` 不提供可用于执行的 `executionContextId`。

### 输出边界与格式

- Sharing 建立时记录输出起点；Sharing 之前的输出不对外回放。
- 输出历史包含边界之后产生的普通 PTY 回显、提示符和命令输出，包括用户在本地终端完成 SSH/嵌套 Shell 交互产生的可读内容。
- 自动 Probe 回显、OSC 777 等协议帧、未回显原始按键和原始 PTY 字节流不进入外部可读历史。
- 外部客户端只收到清理、脱敏后的文本；不提供 ANSI 重绘后的屏幕快照。
- 输出历史只在当前应用运行期保留，不跨应用重启持久化。

### 游标分页

`synapse_observe` 是历史输出的权威读取入口，支持：

- `afterCursor`：从指定历史位置之后读取；首次调用可以省略，从当前 Sharing 边界内最早可读位置开始。
- `tail: true`：读取最近一页，用于上下文冲突后的快速复核；不能与 `afterCursor` 同时使用。
- `maxBytes`：由 Agent 选择本页大小，但受服务端硬上限约束。
- `nextCursor`：下一页起点；`hasMore` 表示本页之后仍有可读内容。
- `historyTruncated` 与 `earliestCursor`：表示请求位置早于保留窗口，并提供可重新同步的最早位置。

游标只由服务端产生和解释；读取不会消费或删除历史，Agent 可以重复使用同一个有效游标。

`synapse_execute` 和 `synapse_wait` 可以返回有限的即时输出、事务输出范围以及当前游标，但完整历史仍通过 `synapse_observe` 分页读取。

## 理由

当前 Session 是本地 PTY，而不是可恢复的远程连接对象。把屏幕仿真、主机拓扑或原始终端流加入 MCP 会扩大 Renderer/Main 边界，并可能把协议控制字符或 Sharing 前的敏感内容暴露给外部客户端。以 Sharing 起点、受限保留窗口和明确游标状态提供清理文本，可以同时支持 Agent 诊断长任务和本地单用户、不持久化的产品边界。

## 影响

- `synapse_observe` 需要由 Session 级输出历史支持，不再只依赖单个事务的临时输出缓冲。
- 历史丢失必须显式报告，不能用头尾摘要冒充连续日志。
- 输出分页和终端屏幕快照是两个独立能力；屏幕快照若要加入，需另行设计 Main 侧终端仿真和受限 API。
- 脱敏必须在分页边界之前完成，避免秘密跨页时被逐页扫描绕过。
