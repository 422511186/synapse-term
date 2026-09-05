## ADDED Requirements

### Requirement: Interactive Transaction Lifecycle

系统 MUST 通过 `synapse_start_interactive` 建立显式交互事务。该工具 MUST 要求已共享 Session、当前 `expectedContextId`、原文 command 和 `inputGrantMode: "one_shot" | "bounded"`，并在 environment Probe、风险分类、审批及所有等待阶段结束后再次验证执行上下文。交互启动的 command MUST 通过字面 Shell 审计、保留标记和 Shell 方言校验；`INTERACTIVE_COMMAND_UNSUPPORTED` 只适用于结构化 `synapse_execute`，不得阻止交互入口接收已知交互式 command。交互启动 MUST 只向 PTY 写入 command 及其终止回车，不得在同一次写入中附加完成 Probe；只有 `write()` 正常返回、表示本地 PTY 后端接受了写入调用后才返回 transactionId 和 inputGrantId，且这不证明远端程序已消费完整 command。

如果启动写入调用已经开始，之后 `write()` 抛错，或 PTY 后端无法确认 command 是否交付，系统 MUST 以 `INTERACTIVE_START_WRITE_UNKNOWN` 失败，不得返回可用于 `input`/`finish` 的 transactionId 或 inputGrantId。系统 MUST 立即失效当前 PTY environment、递增 capability epoch、轮换 executionContextId、撤销未使用的 input grant 并释放交互租约；command 可能已经部分写入或执行，系统 MUST NOT 自动重试，外部客户端 MUST 先重新 observe 并由用户判断后续动作。该尝试可以有短生命周期的内部清理记录，但不得作为客户端可操作事务或持久化状态。

`synapse_finish_interactive` MUST 只接受 `kind: interactive` 且仍为 `running` 的事务，并要求 `observedCursor` 来自调用方最近一次 `synapse_observe` 响应。服务端 MUST 只校验该游标属于当前 Sharing 且不早于最近一次输入的输出位置，不得尝试以提示符启发式代替调用方判断；随后 MUST 在同一 Session 串行顺序中进入内部 `finishing` 阶段，并将新的完成 Probe 作为独立 PTY 写入。收到匹配完成帧时事务 MUST 变为 `completed`；Probe 被目标程序消费、等待超时或 PTY 断开时 MUST 变为 `unknown`，并 MUST 标记 `retryable: false` 与 `safeToResubmit: false`。`finishing` 阶段 MUST 拒绝新的 input 和 interrupt 写入；并发 finish 请求 MUST 复用第一次请求的结果，不得发送第二个 Probe。

交互事务 MUST 对外使用现有 `running`、`completed`、`interrupted`、`unknown` 四种状态；`finishing` 只作为内部阶段。`synapse_finish_interactive` 和事务内 `synapse_input` MUST 校验当前外部调用方拥有该事务的输入/终结能力；`synapse_wait` 在交互事务未 finish 时 MUST 只返回 `running` 快照，不得自行发送完成 Probe。

#### Scenario: Start a sudo interactive transaction

- **WHEN** 外部客户端观察到当前 Shell 后，以当前 `expectedContextId` 和 `inputGrantMode: "bounded"` 调用 `synapse_start_interactive` 提交 `sudo su -`
- **THEN** 服务端 MUST 在审批和再验证通过后只写入 `sudo su -` 的命令 payload，MUST NOT 把完成 Probe 拼在其后，并在写入被接受后返回 `kind: interactive` 的 transactionId、inputGrantId 和 `status: running`

#### Scenario: Interactive start accepts a known interactive command

- **WHEN** 外部客户端以当前 `expectedContextId` 和有效 `inputGrantMode` 调用 `synapse_start_interactive` 提交 `vim notes.txt`
- **THEN** 只要 command 通过字面审计和 Shell 方言校验，系统 MUST 不以 `INTERACTIVE_COMMAND_UNSUPPORTED` 拒绝，且启动写入 MUST 不包含完成 Probe

#### Scenario: Start returns no pre-send transaction

- **WHEN** 交互启动在 Probe、审批或写入前因 Session、租约或 executionContext 失效
- **THEN** 调用 MUST 失败且不得返回可用于 input 的 transactionId，用户 command MUST 不得写入 PTY

#### Scenario: Interactive start write outcome is unknown

- **WHEN** 交互启动已经开始调用 PTY 后端写入启动 command，但 `write()` 抛错或后端无法确认 command 是否已经交付
- **THEN** 调用 MUST 以 `INTERACTIVE_START_WRITE_UNKNOWN` 开头失败，不得返回 transactionId 或 inputGrantId；当前 PTY environment MUST 立即失效，capability epoch 和 executionContextId MUST 轮换，未使用授权 MUST 撤销，交互租约 MUST 释放，且系统不得自动重试 command

#### Scenario: Interactive wait does not inject a probe

- **WHEN** 外部客户端对仍在编辑器或菜单中的交互事务调用 `synapse_wait`
- **THEN** 服务端 MUST 不写入完成 Probe，并返回 `running` 快照或本次等待超时快照

#### Scenario: Finish after the program returns to the Shell

- **WHEN** 外部客户端观察到交互程序已回到 Shell，并携带最近一次 observe 返回的 `observedCursor` 调用 `synapse_finish_interactive`
- **THEN** 服务端 MUST 单独写入完成 Probe，收到匹配帧后返回 `completed`、退出码、事务输出范围和当前上下文

#### Scenario: Premature finish cannot claim completion

- **WHEN** 外部客户端在交互程序仍会读取 stdin 时携带合法 `observedCursor` 调用 `synapse_finish_interactive`
- **THEN** 若 Probe 被程序消费或在固定等待时限内没有匹配帧，事务 MUST 进入 `unknown`，不得伪装成成功或自动重试

#### Scenario: Interactive interrupt

- **WHEN** 外部客户端对 `running` 的交互事务调用 `synapse_interrupt`
- **THEN** 服务端 MUST 向当前 PTY 发送 Ctrl+C，并按既有语义返回 `interrupted`；该结果不承诺远端进程或进程组已经终止

#### Scenario: Interactive transaction idle timeout

- **WHEN** 交互事务连续无输入达到服务端固定空闲上限
- **THEN** 事务 MUST 进入 `unknown`，剩余输入授权和 Session 租约 MUST 被撤销，外部客户端不得自动重放任何输入

### Requirement: Scoped External Input

`synapse_input` MUST 支持两种且仅两种模式。事务内模式 MUST 同时携带 `transactionId`、`inputGrantId` 和唯一 `inputRequestId`，新的输入只能作用于仍为 `running` 的活动交互事务；此前已登记且已完成的相同 requestId 可在事务终态后只读返回缓存结果，不得再次写入。自由模式 MUST 携带 `expectedContextId` 和 `inputRequestId`，且当前 Session 不得存在活动外部事务。两种模式的前提字段 MUST 互斥，`text` 与 `keys` MUST 至少提供其一；规范化后文本为空且键序列为空的请求 MUST 被拒绝且不得消耗授权。

`synapse_execute` MUST NOT 返回后续输入授权；任何预期会读取 stdin 的 command MUST 通过 `synapse_start_interactive`。交互启动 MUST 根据显式的 `inputGrantMode` 返回一次性或有界输入授权。授权 MUST 绑定 Session、事务、外部调用方和用途，不能由原启动调用的 `allow_once` 审批隐式扩大为未声明的输入权限。授权终态、清理或空闲超时后 MUST 撤销。

输入 MUST 先完成规范化和整体校验，再按“先 text、后 keys”的顺序作为一次逻辑 payload 写入 PTY。`text` 只允许可打印 Unicode 字符和 `\n`，换行 MUST 转换为 `\r`；其他 C0/C1 控制字符、DEL、原始 ESC 和任意原始字节 MUST 被拒绝。`keys` MUST 只接受 `up`、`down`、`left`、`right`、`enter`、`esc`、`tab`、`backspace`、`delete`、`home`、`end`、`pageup`、`pagedown`、`space`、`f1` 至 `f12`，并使用设计中固定的 xterm normal-mode 编码。

服务端 MUST 在写入前检查规范化文本 UTF-8 字节数、按键数量和合并 payload UTF-8 字节数；初始上限分别为 8 KiB、128 项和 16 KiB。任一超限时整次调用 MUST 拒绝，任何前缀都不得写入，也不得消耗授权配额。只有首次通过完整校验并实际发起写入的请求才消耗配额；校验/审批拒绝和相同 requestId 的幂等重放不得重复扣减。`textLength` MUST 表示规范化文本的 UTF-8 字节数。

事务内输入 MUST 不校验或轮换 executionContextId，也不得递增 capability epoch；交互事务句柄和 inputGrantId 是其唯一前提。自由输入 MUST 原子校验 expectedContextId，并在进入后端写入尝试的同一 Session 队列边界失效 PTY environment、递增 capability epoch 并轮换 executionContextId；即使 write 抛错或交付不确定也不得恢复旧 context，且 MUST 返回 `INPUT_WRITE_UNKNOWN`。自由输入不得创建 transactionId。自由输入遇到活动事务 MUST 返回 `SESSION_BUSY`。

#### Scenario: Transactional input supplies a password

- **WHEN** 交互事务停在密码提示，外部客户端携带正确的 transactionId、inputGrantId、inputRequestId 和密码文本调用 `synapse_input`
- **THEN** 密码 payload MUST 写入该事务所属 PTY，不弹第二张审批卡片，响应 MUST 返回事务快照、输入元数据和即时输出，但 MUST NOT 包含密码原文

#### Scenario: Input grant is exhausted

- **WHEN** 外部客户端提交的 inputGrantId 已过期、已消费或超过交互授权配额
- **THEN** 调用 MUST 以 `INPUT_GRANT_EXHAUSTED` 开头拒绝，且不得写入 PTY

#### Scenario: Free input requires a current context

- **WHEN** 外部客户端未携带活动事务而以当前 expectedContextId 发送菜单按键
- **THEN** 输入 MUST 写入 PTY，环境和 executionContextId MUST 失效并轮换，响应 MUST 返回新的 executionContextId 和即时输出

#### Scenario: Free input is blocked by an active transaction

- **WHEN** 当前 Session 存在活动外部事务，外部客户端使用 expectedContextId 而不携带 transactionId 调用 `synapse_input`
- **THEN** 调用 MUST 以 `SESSION_BUSY` 开头拒绝，且不得写入 PTY，并指引使用该事务的 inputGrantId

#### Scenario: Stale free-input context

- **WHEN** 用户或其他外部操作已使 expectedContextId 失效，外部客户端仍使用旧 ID 调用自由输入
- **THEN** 调用 MUST 以 `EXECUTION_CONTEXT_STALE` 开头拒绝，且不得写入 PTY

### Requirement: Idempotent Input Requests

每个输入调用 MUST 携带调用方生成的 `inputRequestId`，长度 MUST 为 1 到 256 个字符且不得包含控制字符。在通过调用方、Sharing 和 Session 校验并完成规范化后，服务端 MUST 先以 `(caller identity, sessionId, inputRequestId)` 定位当前应用运行期的有限去重记录，再比较记录中的输入模式、适用的 `inputGrantId`（自由模式为空）和规范化 payload 的 SHA-256 摘要，之后才检查可变的授权额度或 `expectedContextId`。不能把模式或 grant 放进主定位键而让同一 requestId 在另一模式下变成新请求。模式、grant 和摘要完全相同的重试 MUST 直接返回第一次调用的结果摘要而不再次写入，即使该授权随后已消费或自由输入的 context 已轮换；任一不匹配（包括不同 text/keys、输入模式或 grant）MUST 以 `POLICY_DENIED` 拒绝。服务端 MUST 在任何审批等待或 PTY 写入前登记新 requestId 的处理中状态，重复请求只能等待或复用该状态。去重记录和结果摘要不得保存原始 `text`，且结果摘要 MUST 已经过输出脱敏，并随当前 Sharing 关闭、Session 清理、token 撤销、端点关闭或应用重启销毁。写入调用发生异常或交付无法确认时，事务内输入 MUST 将事务置为 `unknown` 并返回 `INPUT_WRITE_UNKNOWN`，自由输入 MUST 返回 `INPUT_WRITE_UNKNOWN`；两种情况都不得要求客户端换用新 requestId 自动重放。

#### Scenario: Retrying the same input does not duplicate bytes

- **WHEN** 外部客户端因响应丢失而使用相同 inputRequestId 重试同一密码或按键序列
- **THEN** 服务端 MUST 返回第一次调用的发送摘要，PTY MUST 只收到一次该 payload

#### Scenario: Request ID payload conflict

- **WHEN** 同一个 inputRequestId 第二次携带不同的 text 或 keys
- **THEN** 调用 MUST 以 `POLICY_DENIED` 开头拒绝，且不得写入第二个 payload

#### Scenario: Request ID cannot cross input modes or grants

- **WHEN** 同一个调用方在同一 Session 复用已登记的 `inputRequestId`，但改用另一输入模式或另一 `inputGrantId`
- **THEN** 调用 MUST 以 `POLICY_DENIED` 开头拒绝，且不得写入第二个 payload

### Requirement: Interactive Input Approval

`read_only` 模式 MUST 拒绝交互启动和自由输入。交互启动一旦成功会授予后续 PTY 写入能力，因此 `managed` 模式下 MUST 按长期可写入能力处理；未命中会话内放行记录时 MUST 弹审批卡片，不因 command 被普通风险分类判为低危而自动放行。卡片 MUST 展示启动 command、选定的 `inputGrantMode` 和该档位的固定上限，但不得展示未来输入。结构化 `synapse_execute` 仍沿用既有风险矩阵。交互事务内输入使用启动时签发的授权，不重复弹卡片；每次新的交互事务 MUST 获得新的有限授权。自由输入在 `managed` 下未命中会话内放行时 MUST 逐调用审批，并对规范化文本和键名展示审批内容；`full` 模式放行执行权但仍执行输出脱敏。

#### Scenario: Managed approval grants a bounded interactive transaction

- **WHEN** 审批模式为 `managed` 且外部客户端调用 `synapse_start_interactive` 并选择输入授权档位
- **THEN** 调用 MUST 阻塞等待审批；“允许一次”只批准本次启动及其明确选择的有限输入授权，“会话内放行”只匹配相同 command、执行模式和授权模式，拒绝或超时不得写入命令

#### Scenario: Transactional input does not inherit unlimited approval

- **WHEN** 一个启动调用已获 `allow_once`，外部客户端尝试超过 inputGrantId 的范围继续发送输入
- **THEN** 超出范围的调用 MUST 被拒绝，不能因为原审批仍属于同一事务而继续获得输入权限

### Requirement: Interactive Environment Revalidation

交互启动 MUST 遵循现有执行上下文的原子校验和等待后再验证规则。启动命令写入成功后 MUST 轮换 executionContextId；交互事务内输入由事务句柄保护，不逐次轮换 context。交互事务变为 `completed`、`interrupted` 或 `unknown` 后，Session MUST 失效当前 PTY environment、递增 capability epoch 并轮换 executionContextId；后续结构化执行 MUST 先重新观察并运行 Probe。

#### Scenario: Nested shell invalidates the next structured command

- **WHEN** 交互事务期间外部客户端进入嵌套 Shell、SSH 或改变工作目录，随后 finish 或 interrupt 结束事务
- **THEN** Session MUST 将当前 environment 标记为未验证，下一次 `synapse_execute` 在重新 observe/Probe 前不得写入命令

## MODIFIED Requirements

### Requirement: Synapse Tool Surface

MCP 端点 MUST 暴露且仅暴露八个工具：`synapse_execute`（按执行上下文执行结构化命令并开启事务）、`synapse_start_interactive`（启动显式交互事务）、`synapse_input`（发送事务内或自由输入）、`synapse_finish_interactive`（发送交互事务的终结 Probe）、`synapse_observe`（分页读取 PTY 输出历史）、`synapse_wait`（等待事务收敛）、`synapse_interrupt`（向进行中的事务所属 PTY 发送中断）和 `synapse_status`（只读探测会话状态）。所有工具 MUST 以 `sessionId` 寻址，Schema MUST 完整声明参数与含义，MUST NOT 提供清单之外的工具。

`synapse_execute` MUST 接收 `expectedContextId`、原文 `command` 和可选的观察窗口，并保持结构化完成 Probe 语义；`synapse_start_interactive` MUST 接收 `command`、`expectedContextId` 和 `inputGrantMode`，允许通过字面审计但被结构化入口拒绝的已知交互式 command；`synapse_input` MUST 接收互斥的事务字段或自由字段、`inputRequestId` 以及至少一个 `text`/`keys`；`synapse_finish_interactive` MUST 接收 `transactionId` 和 `observedCursor`；`synapse_observe` MUST 接收可选的 `afterCursor`、`tail` 和 `maxBytes`；`synapse_wait` MUST 接收 transactionId 和单次等待时限，默认 30 秒且不得超过 60 秒；`synapse_interrupt` MUST 接收 transactionId；`synapse_status` MUST 保持只读且不得返回 `executionContextId`。工具响应 MUST 能表达即时输出、事务输出范围、下一游标、截断状态和当前执行上下文 ID；输入响应不得回显 `text` 原文、原始 PTY 字节、Probe 原文或屏幕快照。

#### Scenario: HTTP tool listing exposes exactly eight tools

- **WHEN** 外部客户端通过 Streamable HTTP 请求 `tools/list`
- **THEN** 返回结果 MUST 恰好包含上述八个工具，且每个新增工具的描述 MUST 说明其生命周期前提

#### Scenario: Execute opens a transaction

- **WHEN** 外部客户端调用 `synapse_execute` 且策略允许
- **THEN** 命令写入共享会话 PTY，返回结构化事务 ID 与观察窗口内的初始输出

#### Scenario: Execute opens a guarded transaction

- **WHEN** 外部客户端调用 `synapse_execute`，携带当前 `expectedContextId` 且策略/审批允许
- **THEN** 系统 MUST 在 Probe 与执行前再验证通过后，将用户 command 原文写入共享 Session PTY，返回 transactionId、事务状态、有限即时输出、事务输出范围和当前执行上下文 ID

#### Scenario: Observe paginates history

- **WHEN** 外部客户端调用 `synapse_observe` 并传入 `afterCursor` 与 `maxBytes`
- **THEN** 系统 MUST 返回不超过服务端上限的清理脱敏文本、`nextCursor` 和 `hasMore`，且不得消费历史

#### Scenario: Interrupt an in-flight transaction

- **WHEN** 外部客户端对进行中的结构化或交互事务调用 `synapse_interrupt`
- **THEN** 该事务被中断并返回中断确认，事务不再收敛为完成态

#### Scenario: Interactive input response omits text

- **WHEN** 外部客户端发送包含密码文本的有效 input 请求
- **THEN** JSON 响应 MUST 只包含规范化文本长度、键名、payload 字节数、输出窗口、游标和必要状态，不得出现密码原文

### Requirement: External Transaction State Contract

每个已接受的外部事务 MUST 公开 `kind: structured | interactive`，并只使用 `running`、`completed`、`interrupted` 或 `unknown` 状态。结构化事务仍由完成 Probe 自动收敛；交互事务只有在显式 finish 后才发送完成 Probe。事务 ID MUST 只在对应启动命令的 `write()` 正常返回后返回；写入前失败不创建 transactionId，写入调用已开始但结果不确定时也不得创建客户端句柄。一个 Session 同时最多允许一个结构化或交互外部事务，交互事务的输入授权和租约必须在终态、清理或空闲超时后释放。

#### Scenario: Concurrent external writes are rejected

- **WHEN** 一个 Session 已存在结构化或交互外部事务，另一个外部调用尝试 execute、start、finish 或自由 input
- **THEN** 其他事务的 execute/start、自由 input 或不属于当前事务的写入 MUST 返回 `SESSION_BUSY` 且不得写入第二个 payload；当前交互事务所属 caller 的 finish、input 和 interrupt 按交互事务生命周期处理，不得被该规则误拒

#### Scenario: Session rejects a concurrent external transaction

- **WHEN** 一个 Session 已存在未收敛的外部事务，另一个外部客户端调用 `synapse_execute`
- **THEN** 调用 MUST 返回 `SESSION_BUSY`，不得写入第二条用户命令

#### Scenario: Non-zero command exit is completed

- **WHEN** 完成 Probe 返回一个非零退出码
- **THEN** 事务 MUST 返回 `status: completed` 和该退出码，不得把已确认的命令结果标记为 `unknown`

#### Scenario: Completion evidence is lost

- **WHEN** 用户命令可能已经写入或执行，但 PTY/连接在有效完成证据到达前断开
- **THEN** 事务 MUST 进入 `unknown`，明确 `retryable: false` 和 `safeToResubmit: false`，不得自动重新提交

#### Scenario: Wait reaches its per-call timeout

- **WHEN** `synapse_wait` 在本次调用的等待时限内没有等到事务终态
- **THEN** 调用 MUST 返回当前 `running` 快照并标记本次等待超时，事务仍可继续等待、观察或中断

#### Scenario: User input interferes with a running transaction

- **WHEN** 用户在事务尚未获得完成证据前向同一 PTY 输入内容
- **THEN** 本地输入 MUST 保持可用，事务 MUST 进入 `unknown`，且外部客户端不得自动重试

### Requirement: Stable External Error Codes

所有 `synapse_*` 工具的错误结果 MUST 以稳定可解析的错误码开头：认证撤销为 `AUTHORIZATION_REVOKED`，会话未就绪为 `SESSION_NOT_READY`，会话失效为 `SESSION_EXPIRED`，租约不可用为 `SESSION_BUSY`，事务不存在为 `TRANSACTION_NOT_FOUND`，策略拒绝为 `POLICY_DENIED`，Shell 方言不匹配为 `SHELL_MISMATCH`，命令违反字面审计边界为 `COMMAND_NOT_AUDITABLE`，已知交互式命令不支持为 `INTERACTIVE_COMMAND_UNSUPPORTED`，缺少执行上下文为 `EXECUTION_CONTEXT_REQUIRED`，执行上下文失配为 `EXECUTION_CONTEXT_STALE`，输出游标失效为 `OUTPUT_CURSOR_STALE`，审批超时为 `APPROVAL_TIMEOUT`，审批拒绝为 `APPROVAL_DENIED`，输入授权失效或额度耗尽为 `INPUT_GRANT_EXHAUSTED`，输入写入交付无法确认为 `INPUT_WRITE_UNKNOWN`，交互启动写入交付无法确认为 `INTERACTIVE_START_WRITE_UNKNOWN`。MUST NOT 暴露 `TRANSACTION_NOT_ACTIVE`。事务已终态、未知或不属于当前 Sharing 的未知事务调用统一使用 `TRANSACTION_NOT_FOUND`；已登记 requestId 的相同输入重试例外地只读返回缓存结果。错误文本 MUST 同时包含错误码、原因与下一步指引，且不得泄露其他会话信息。

#### Scenario: No public pre-send transaction race

- **WHEN** 外部客户端调用不存在、未被后端接受，或没有可复用 requestId 的已终态事务 ID 进行 input 或 finish
- **THEN** 调用 MUST 以 `TRANSACTION_NOT_FOUND` 开头，且不得向 PTY 写入任何内容

#### Scenario: Unknown input delivery is not retried blindly

- **WHEN** PTY 后端无法确认某次 input payload 是否已经交付
- **THEN** 调用 MUST 以 `INPUT_WRITE_UNKNOWN` 开头；事务内模式还 MUST 返回 `status: unknown`，并指引客户端不要使用新 requestId 重放

#### Scenario: Unknown interactive start delivery is not retried blindly

- **WHEN** 交互启动 command 的 PTY 写入调用已开始，但后端抛错或无法确认 command 是否已经交付
- **THEN** 调用 MUST 以 `INTERACTIVE_START_WRITE_UNKNOWN` 开头；不得返回可操作的 transactionId 或 inputGrantId，Session environment/context/epoch、未使用授权和交互租约 MUST 按启动写入不确定语义清理，客户端不得使用新调用自动重放

#### Scenario: Execute fails while shell not ready

- **WHEN** `synapse_execute` 到达且 Shell 正在探测
- **THEN** 错误以 `SESSION_NOT_READY` 开头并附稍后重试指引

#### Scenario: Transaction not found

- **WHEN** `synapse_wait` 携带不存在的事务 ID
- **THEN** 错误以 `TRANSACTION_NOT_FOUND` 开头并指引检查 execute 返回值

#### Scenario: Missing execution context

- **WHEN** `synapse_execute` 没有携带 `expectedContextId`
- **THEN** 错误 MUST 以 `EXECUTION_CONTEXT_REQUIRED` 开头，且用户命令不得写入 PTY

#### Scenario: Stale execution context

- **WHEN** `synapse_execute` 携带的 `expectedContextId` 已因用户输入或其他外部事务失效
- **THEN** 错误 MUST 以 `EXECUTION_CONTEXT_STALE` 开头，指引外部客户端先调用 `synapse_observe` 获取当前内容和新 ID

#### Scenario: Known interactive command

- **WHEN** 外部客户端提交明确需要持续交互或不会返回当前 Shell 提示符的 command
- **THEN** 调用 MUST 以 `INTERACTIVE_COMMAND_UNSUPPORTED` 开头失败，且不得写入用户命令

#### Scenario: Transaction is unknown after a disconnect

- **WHEN** 外部事务在完成证据到达前失去 PTY 或连接
- **THEN** 工具结果 MUST 返回 `unknown` 事务状态和不可自动重试的指引，而不是把它伪装成 `POLICY_DENIED` 或普通失败

### Requirement: Three-Tier Approval Modes

审批模式的三档规则 MUST 扩展到交互启动和输入，同时保留结构化调用的既有矩阵：`read_only` 只允许观察类调用；`managed` 对未命中会话内放行的交互启动按所选输入授权档位进入审批卡片，对自由输入逐调用审批；`full` 放行这些调用但不绕过输出脱敏。任何模式下，事务内 input 都只能使用已明确签发且有界或一次性的 inputGrantId；结构化 `synapse_execute` 不提供后续输入授权。

#### Scenario: Read-only rejects writes

- **WHEN** 审批模式为 `read_only` 且外部调用 `synapse_execute`
- **THEN** 调用被拒绝并返回稳定错误码，不弹出审批卡片

#### Scenario: Managed escalates unknown commands

- **WHEN** 审批模式为 `managed` 且命令被风险分类判定为高危或未分类
- **THEN** 调用进入审批卡片流程等待人工裁决

#### Scenario: Full mode allows all

- **WHEN** 用户显式选择 `full` 模式且外部提交任意风险级别命令
- **THEN** 调用自动放行，输出仍经脱敏管线

#### Scenario: Corrupted configuration falls back

- **WHEN** 设置文件损坏或审批模式值非法
- **THEN** 加载结果回退为关闭＋`read_only`，外部写类调用默认被拒

### Requirement: In-Session Command Grant

审批卡片上的会话内放行 MUST 只对同一 Session 内、与已放行操作的规范化授权键完全相等的后续调用自动通过；记录 MUST 存于该 Session 的管线缓存，并随 Session 关闭、取消 Sharing、PTY 退出、MCP token 撤销或端点关闭而销毁。命令启动的授权键 MUST 包含原文 command、执行模式（`structured` 或 `interactive`）和 `inputGrantMode`（结构化执行使用 `none`）；自由输入的授权键 MUST 包含固定的 `free_input` 标识、规范化 text 和按序 keys。随机的 transactionId、inputGrantId 和 inputRequestId MUST NOT 进入匹配键；记录 MUST NOT 持久化，也不得使用通配符或前缀匹配。每次命中交互命令键时仍 MUST 为新事务签发新的有限 inputGrantId，不得复用旧授权。

#### Scenario: Exact match auto-allows within session

- **WHEN** 用户曾在本 Session 对结构化 command `npm test` 选择会话内放行，随后同一模式再次提交完全相同的 command
- **THEN** 调用自动放行，不弹审批卡片

#### Scenario: Interactive grant mode is part of the exact key

- **WHEN** 用户曾对 interactive command `sudo su -` 选择 `bounded` 输入授权的会话内放行，随后以 `one_shot` 或结构化模式提交相同 command
- **THEN** 两种调用均不命中该记录，分别按自身授权模式重新执行审批策略

#### Scenario: Free-input grant matches the normalized representation

- **WHEN** 用户曾对同一 Session 的规范化自由输入 `keys: ["down", "enter"]` 选择会话内放行，随后提交相同的 text/keys 表示
- **THEN** 调用自动放行；任意键顺序、文本或 Session 变化均不得命中

#### Scenario: Grant does not leak across sessions or variants

- **WHEN** 另一 Session 到达相同 command，或当前 Session 到达 command 的变体、不同执行模式或不同输入授权模式
- **THEN** 两种情况均不命中记忆，照常走分类与审批流程

### Requirement: Execution Context Guard

`expectedContextId` 的强制校验 MUST 扩展到 `synapse_start_interactive` 和自由模式 `synapse_input`。Probe、审批或其他等待后必须再验证；交互启动的写入调用正常返回后必须轮换 context，写入调用已开始但结果不确定时也必须立即失效 environment、递增 epoch 并轮换 context。事务内 `synapse_input` 使用 transactionId/inputGrantId，不得用旧 context 绕过事务授权；交互终态或交互启动写入不确定后必须要求后续结构化调用重新观察和 Probe。

#### Scenario: First execution requires an observation

- **WHEN** 外部客户端首次调用 `synapse_execute` 且未提供 `expectedContextId`
- **THEN** 调用 MUST 返回 `EXECUTION_CONTEXT_REQUIRED`，不得写入用户命令，并指引外部客户端调用 `synapse_observe` 获取当前终端内容和 ID

#### Scenario: Stale execution context is rejected

- **WHEN** 外部客户端提供的 `expectedContextId` 与当前 Session 的 ID 不匹配
- **THEN** 调用 MUST 返回 `EXECUTION_CONTEXT_STALE`，不得写入用户命令，并指引外部客户端使用 `synapse_observe`（必要时 `tail: true`）重新观察后再决定是否执行

#### Scenario: Context changes during preflight

- **WHEN** 用户在 Probe 或审批等待期间改变当前 PTY，导致原执行上下文失效
- **THEN** 系统 MUST 在写入用户命令前再次拒绝该调用，旧 Probe 和旧审批不得继续放行用户命令

#### Scenario: Passive output does not invalidate the context ID

- **WHEN** 当前 Session 只有被动日志或提示符输出增长而没有新的用户/外部输入
- **THEN** `executionContextId` MUST 保持不变，输出位置只通过 `outputCursor` 变化

### Requirement: Local Execution Visibility

结构化事务和交互事务从其启动写入被接受到完成、打断或不确定终态期间，必须沿用现有外部执行可见性标记；状态展示可标注交互事务和内部 finish 等待，但不得阻止本地用户输入。用户输入仍会使活动交互事务进入 `unknown`，并撤销其授权和租约。该可见性要求 MUST 保持信息展示性质。

#### Scenario: Badge shows during external execution

- **WHEN** 外部调用 `synapse_execute` 开始一个事务
- **THEN** 会话标签出现徽标、面板出现状态栏，悬停或详情查看可见命令全文与来源客户端标识

#### Scenario: Local typing stays available

- **WHEN** 外部事务执行期间用户聚焦该终端并键入内容
- **THEN** 键入正常进入 PTY，不被标记或审批拦截

#### Scenario: Long command does not obscure terminal output

- **WHEN** 外部执行中的命令长度超过状态栏可用宽度
- **THEN** 状态栏 MUST 截断或折叠命令摘要并保留可访问的完整命令，Terminal Session 的输出内容 MUST 仍可阅读
