# ADR-0018：MCP 外部执行的执行上下文校验

状态：已接受

## 决策

外部命令执行采用基于 `executionContextId` 的乐观并发校验。外部客户端只能基于最近观察到的当前 Session 前提提交命令；执行前提变化后，旧命令必须在 PTY 写入前失效。

### 执行上下文

- `synapse_observe` 返回当前终端内容和 `executionContextId`。
- `synapse_execute` 必须传入 `expectedContextId`；首次执行也必须先通过 `synapse_observe` 建立执行前提。
- `synapse_execute` 和 `synapse_wait` 返回当前 ID，便于正常连续执行；`synapse_status` 不返回该 ID。
- 用户本地输入、外部事务提交或环境失效会使 ID 变化；被动输出增长只推进输出游标，不改变 ID。
- 缺少 ID 返回 `EXECUTION_CONTEXT_REQUIRED`；ID 不匹配返回 `EXECUTION_CONTEXT_STALE`。两者都不得写入用户命令，并要求 Agent 先使用 `synapse_observe`（必要时 `tail: true`）取得当前内容和新 ID。

### 原子校验与再验证

执行上下文校验和 PTY 写入必须遵循同一 Session 的串行顺序。Probe、人工审批等等待阶段结束后，真正写入用户命令前必须再次校验执行上下文；旧 Probe 或旧批准不得跨越上下文变化继续放行。

本地用户输入始终保持可用：

- 用户输入先于外部写入进入队列时，外部命令不写入 PTY；
- 外部命令先被接受后，用户在完成证据到达前输入，事务进入 `unknown`；
- 已收到完成证据并处于排空阶段的事务可以按完成结果收敛。

### 事务与 Probe

- 一个 Session 同时只允许一个外部事务。
- `running` 表示尚未获得完成证据；`completed` 表示收到有效完成证据，非零退出码仍属于 `completed`；`interrupted` 表示本地 PTY 中断已按事务语义收敛；`unknown` 表示可能已执行但结果无法确认。
- `not_sent` 是写入前错误，不创建事务 ID。连接或 PTY 在完成证据前断开时使用 `unknown`，不得自动重试。
- `synapse_wait` 的单次等待超时只返回当前快照，不改变事务；长任务通过重复等待、观察或中断处理。
- 固定完成 Probe 对结构化外部执行是必需的，不提供关闭 Probe 的外部执行选项。
- 明确识别为交互式的命令以 `INTERACTIVE_COMMAND_UNSUPPORTED` 拒绝；无法静态判断的自定义脚本仍可按原文执行，并由风险分类与完成证据决定结果。
- `synapse_interrupt` 只承诺向当前 PTY 发送中断，不承诺远程进程或进程组已终止。

### 风险边界

风险分类继续使用 `read_only`、`mutating`、`privileged`、`destructive` 和 `unknown`，并返回置信度、判定原因和确认要求。分类基于原始命令和已验证的当前 PTY 环境，不主动探测远程主机权限、资源影响或回滚条件；审批仍遵循 ADR-0015。

## 理由

Session 的 PTY 可以被用户和外部客户端共同操作，单纯依赖上一次输出或事务 ID 无法证明执行前提仍未改变。`executionContextId` 提供了可验证的执行前提绑定，同时保留本地用户控制权。把校验与写入串行化，并在等待阶段后再验证，可以避免 Agent 在用户刚完成 SSH/容器切换或其他命令已经执行后盲目提交高风险命令。

## 影响

- Share Text 和外部工具调用顺序需要包含“先观察、取得执行上下文 ID、再执行”。
- Main 需要维护独立于 `capability epoch` 的执行上下文标记；前者用于命令顺序防护，后者用于当前 PTY 环境验证失效。
- 旧的只传 `sessionId` 和命令文本的 `synapse_execute` 调用将收到稳定错误，不能静默兼容为无校验执行。
- 该决定不引入主机资产、凭据、SSH 拓扑或远程进程模型。
