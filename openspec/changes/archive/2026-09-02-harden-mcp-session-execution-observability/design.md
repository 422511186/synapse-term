## Context

当前 Electron Main 通过 `SessionActor` 持有 PTY，并以串行队列协调用户输入、Probe、环境验证和外部写入。`CommandExecutor` 已经负责完成探针、事务等待和有限的事务输出，`ExternalToolPipeline` 负责 Sharing 后的租约、策略、审批和脱敏，`McpController` 为每个明确共享的 Session 装配一条管线。现有观察能力仍依赖最近事务的临时 `OutputBuffer`，不能覆盖无事务期间的用户输出、长输出分页或 Sharing 边界。

本设计在上述边界内扩展能力。动机和外部行为见 `proposal.md`；具体 MUST/SHALL 要求以 `specs/` 下四份 delta spec 为准。实现必须继续遵守现有 ADR：Renderer 不能接触 PTY，Session 不建模 SSH/主机拓扑，不持久化 Session 或审计日志，外部客户端只能操作明确 Sharing 的 Session。

## Goals / Non-Goals

**Goals:**

- 在 Session 级提供当前 Sharing 边界内的、受限保留的 PTY 输出历史，并支持可重复的游标分页、尾部观察和显式历史截断。
- 在协议帧隔离和连续脱敏之后再建立外部可读历史，保证 Probe、OSC 777、原始 PTY 字节和屏幕重绘不会进入 MCP 响应。
- 将外部执行绑定到最近观察得到的执行上下文，并在所有可能等待的阶段之后以原子方式再次校验后才写入用户 command。
- 保留本地用户输入优先且不锁定 PTY 的产品语义；无法取得完成证据时向外部客户端诚实报告 `unknown`，禁止自动重提。
- 让五个 `synapse_*` 工具、Share Text、Main 内部管线和 terminal-service 类型共享同一套游标、上下文 ID、事务和稳定错误契约。

**Non-Goals:**

- 不实现屏幕快照、终端仿真后的屏幕状态、未回显按键、原始 PTY 流、跨应用重启回放或持久化审计日志。
- 不引入远程主机资产、SSH/跳板机/容器拓扑、远程 PID、远程权限探测、凭据库或远程进程终止确认。
- 不允许外部调用绕过固定 Probe、字面审计、输出脱敏、审批模式或受限 preload/IPC 边界。
- 不把“本次 `synapse_wait` 超时”升级为事务终态，也不把非零退出码误判为失败或不确定。

## Decisions

### 1. SessionActor 持有单一输出历史，Sharing 只保存边界

`SessionActor` 继续只通过 terminal-service 的公共事件提供已经经过 OSC 777/协议帧解析、Probe 回显隔离和低位控制字符清理的 `pty_output`。`McpController.share()` 在注册 Sharing 时为该 Session 装配一个 Main 侧的 Sharing 输出历史采集器；采集器订阅这个公共事件流，在连续的流式脱敏之后写入按字节限制的环形保留窗口，分页层只读取已清理文本。这样 MCP 专属的 `SecretRedactor` 不会成为 terminal-service 的反向依赖，且每个 Session 同时只有一份 Sharing 级历史。

`McpController.share()` 在装配管线时记录当前历史位置和新的 Sharing generation；管线只允许读取该 generation 之后的记录。取消 Sharing、Session 退出、Token 变更或端点关闭都销毁管线并使其游标失效，再次 Sharing 生成新的边界。游标携带不可由客户端伪造的 Session/Sharing 作用域信息；旧 Sharing 的游标不得映射到新边界的数据，过期游标返回稳定的可重新同步结果。

选择 Session 级历史而不是每个事务的缓冲，是为了覆盖用户输入、Probe 之间的输出和没有外部事务时的输出；选择内存有界历史而不是文件日志，是为了保持应用运行期和单用户本地边界。

### 2. 先连续清理脱敏，再按游标分页

输出管线按以下顺序处理：PTY 字节分帧 → `SessionActor` 识别并移除 OSC 777 → 移除自动 Probe 回显 → 清理不允许的控制字符 → Main 侧采集器在连续文本上执行流式 `SecretRedactor` → 写入当前 Sharing 历史 → 应用 `afterCursor`/`tail` 和服务端 `maxBytes`。

脱敏器保留有限的跨 chunk 匹配 carry，且 carry 也受大小上限约束；因此秘密跨内部事件或外部页边界时，分页不会暴露尚未扫描的片段。页大小由 Agent 选择但被服务端硬上限钳制。`nextCursor` 指向服务端解释的下一位置，`hasMore` 只描述当前页之后是否仍有内容；`historyTruncated` 和 `earliestCursor` 单独描述请求位置早于保留窗口的事实。

`tail: true` 直接从当前 Sharing 边界内的最近可读位置计算一页，用于上下文冲突后的复核；它与 `afterCursor` 互斥，不改变普通分页的起点，也不改变历史。

### 3. 用共享的串行队列实现执行前原子校验

在领域/terminal-service 公共类型中增加独立的执行上下文 ID，并将其与已有 `capabilityEpoch` 分开维护：

- 用户输入或环境失效时，`SessionActor` 在同一串行队列中失效环境并轮换执行上下文；被动 PTY 输出只推进输出游标，不轮换上下文。
- 外部事务被接受写入时，在同一原子操作中校验 `expectedContextId` 和已验证的能力代际，轮换上下文并写入原文 command 加固定 Probe；Probe 本身走独立的外部写入入口，不冒充用户接管。
- `synapse_execute` 的 Probe、风险分类和审批可能异步等待。真正写入前必须重新读取并校验两个前提；任一失效都返回 `EXECUTION_CONTEXT_STALE` 或 `SESSION_NOT_READY`，不产生用户 command 写入。
- 用户写入先进入队列时，外部写入被拒绝；外部写入先被接受时，后续用户输入仍可正常进入 PTY，但当前事务因完成证据被干扰而进入 `unknown`。

这比在管线中先读快照、稍后单独写 PTY 更可靠，因为校验与写入之间没有可被用户输入插入的非串行间隙。`synapse_status` 不暴露执行上下文 ID，只有 `observe`、`execute` 和 `wait` 返回当前 ID，避免把只读状态探测误当作执行前观察。

### 4. 保留固定 Shell Driver Probe，并把事务状态收敛为外部契约

`CommandExecutor` 继续通过当前已验证方言的 `ShellDriver` 构造字面 dispatch：用户 command 原文后紧跟独立完成 Probe，使用 nonce 和 OSC 777 完成帧；Probe 不把用户 command 作为变量、脚本块或编码参数再次执行。PowerShell 路径继续使用 `$?`/`$LASTEXITCODE`，不使用 `-EncodedCommand`。字面审计和交互式命令判断必须发生在任何用户 command 写入之前。

内部可以保留更细的诊断原因，但 MCP 对外只映射为 `running`、`completed`、`interrupted`、`unknown` 四种已接受事务状态。有效完成帧（包括非零退出码）将事务收敛为 `completed`；中断只承诺当前 PTY 收到中断并依据可验证证据收敛；PTY 退出、用户干扰、Probe 丢失或分享管线销毁导致完成证据不可靠时为 `unknown`，返回 `retryable: false` 和 `safeToResubmit: false`。所有写入前拒绝，包括租约冲突、缺少/失配上下文、审计拒绝和交互式命令，不创建 transaction ID。

事务记录只保存输出历史中的起始游标和当前结束游标；即时输出是受上限约束的历史视图，完整内容统一由 `synapse_observe` 读取。完成帧之后使用现有有上限的 drain window 收集已经到达的普通输出，再更新事务范围，Probe 和控制帧始终被排除。

### 5. 把风险证据和审批作为写入前阶段，而不是新的权限边界

管线在环境 Probe 成功后始终使用原始 command 和已验证的当前 PTY environment 调用 `PolicyEngine`，形成 `risk`、`confidence`、`reasons` 和 `requiresConfirmation`。复杂管道、脚本、别名和嵌套调用在无法完全静态展开时使用低置信度或 `unknown`，不声称验证了远程权限、资源影响或回滚条件。

审批继续遵循 ADR-0015 的 `read_only`、`managed`、`full` 三档和会话内放行；审批卡片返回后必须执行上下文再验证。审批只是授权阶段，不能替代最终的原子校验，也不能让旧 Probe 或旧批准跨越用户输入继续执行。

### 6. 由 Main 管理单 Session Sharing 和工具 Schema

`McpController` 继续以精确 `sessionId` 查找共享管线，不提供枚举；每个共享 Session 只有一个 `ExternalToolPipeline`、一个 `CommandExecutor` 和一个活跃外部事务。管线负责把历史读取、上下文检查、租约、审批、事务和脱敏组合起来，MCP 入口只负责 Zod Schema 校验、授权 Token 校验和稳定错误映射。

更新后的工具 Schema 明确声明：`execute` 必填 `expectedContextId`，`observe` 支持 `afterCursor`、互斥 `tail` 和受限 `maxBytes`，`wait` 使用默认 30 秒且不超过 60 秒的单次等待。所有返回都使用可序列化的结构化字段，不返回 Probe 原文、原始 PTY 数据或内部 Lease/能力代际。Share Text 同步描述“status → observe → 带 ID execute → wait/observe”的恢复流程，并明确 `not_ready` 不应循环查询 status。

## Risks / Trade-offs

- [有界历史可能丢失长任务早期输出] → 明确返回 `historyTruncated` 和 `earliestCursor`，不伪造连续日志；Agent 可从最早游标重新同步。
- [Sharing 级历史增加每个共享 Session 的 Main 内存占用] → 采用固定字节上限、取消 Sharing 时释放，不持久化；`maxBytes` 只影响响应，不允许扩大服务端保留上限。
- [流式脱敏 carry 可能截断极端长秘密或造成少量误报] → carry 使用独立硬上限并采用保守替换；测试跨事件、跨页和 UTF-8 边界，优先避免泄露。
- [执行上下文轮换使旧外部客户端调用出现兼容性错误] → 以稳定 `EXECUTION_CONTEXT_REQUIRED/STALE` 返回原因和下一步指引，Share Text 强制建立/刷新观察；旧的无 ID `synapse_execute` 不静默降级。
- [用户输入与外部事务并发时无法证明远程结果] → 不锁定本地输入；把完成证据前的干扰收敛为 `unknown`，禁止自动重提并保留输出供用户判断。
- [固定 Probe 可能出现在目标 Shell/SSH 的审计设施中] → 继续使用独立、可识别、无用户 command 插值的 Probe，并在 Share Text/设置中说明；回显隐藏只影响本地终端 UI。
- [PTY 输出到达顺序和完成帧顺序存在边界竞态] → 使用 SessionActor 串行事件队列和有上限 drain window；无法取得可靠帧时宁可 `unknown`，不伪造 `completed`。
- [工具 Schema 变更导致旧外部客户端失败] → 保持五工具名称和稳定错误格式，先返回可操作指引；通过 MCP 单元、协议和 Electron E2E 测试覆盖新握手顺序。
- [Sharing 取消或 Token 变更时仍有等待中的外部调用] → Controller 先取消审批、销毁管线并使游标失效；活动事务若可能已写入则标记为不可自动重提的终态，不留下跨 Sharing 的可读历史。

## Migration Plan

这是一次内存态协议变更，不需要数据库或用户数据迁移。实现按以下顺序落地：先扩展 domain/terminal-service 的上下文和事务类型并保持 `SessionActor` 的协议安全事件，再在 Main 的 Sharing 管线中加入历史采集/脱敏，接着更新 `CommandExecutor`、MCP Schema、错误映射和 Share Text，最后补齐单元、集成、协议和 Electron E2E 测试。

部署后，新客户端必须先 `synapse_observe` 再执行；旧客户端缺少 `expectedContextId` 时收到 `EXECUTION_CONTEXT_REQUIRED`，不得被兼容为无校验执行。回滚只需回退应用代码并重启内嵌 MCP Server；由于历史、游标、事务和上下文均不跨应用持久化，回滚不会留下需要清理的持久化格式。若回滚过程中已有外部事务，按 `unknown` 处理并要求用户判断，禁止自动重新提交。
