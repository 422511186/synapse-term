## Context

MCP 端点现有五个工具。`synapse_execute` 为结构化外部事务提供严格的完成语义：它先验证当前 PTY environment，再把用户 command 和完成 Probe 写入同一条字面 Shell payload，之后由 `osc_777` 完成帧收敛事务。这个协议适合会返回当前 Shell 的命令，不适合会读取 stdin 的程序；交互程序会把排在后面的 Probe 当作自己的输入，因而不能通过“延迟发送 Probe”修复。

Session 的 PTY 同时受本地用户和外部客户端驱动。外部调用必须通过共享边界、Session 租约、执行上下文和审批模式；本地用户输入始终保留优先权。PTY 后端的 `write()` 没有交付回执，因此本变更只能定义“写入调用被后端接受”的边界，不能假定远端程序已经消费完整输入。

## Goals / Non-Goals

**Goals:**

- 通过显式交互事务支持 `sudo` 密码、编辑器、堡垒机菜单和 REPL 等持续 stdin 场景。
- 保留 `synapse_execute` 的可验证完成 Probe 语义；结构化执行和交互执行使用不同的启动与收敛协议。
- 为交互输入提供绑定 Session、事务和调用方的有限输入授权，支持明确选择一次性或有界多次档位。
- 让输入请求可去重、可限流、可按固定协议编码，并在响应中避免回显文本原文。
- 保留 Session 串行队列、外部租约、执行上下文防护、用户输入优先权、Sharing 输出历史和输出脱敏边界。

**Non-Goals:**

- 不把任意交互程序的语义、提示符或菜单选项解析成领域对象。
- 不通过 Shell 提示符启发式自动判断交互事务已经结束。
- 不允许外部客户端发送任意原始 PTY 字节、任意转义序列或修饰键组合；`ctrl+c` 继续由 `synapse_interrupt` 负责。
- 不保证密码不会出现在 PTY 回显、终端 UI、Sharing 输出历史或审批卡片；本变更只保证工具响应不回显 `text` 原文。
- 不把一次 `allow_once` 审批扩展为无限期或无限内容的后续命令权限。
- 不持久化交互事务、输入授权、输入去重记录或远程主机状态。

## Decisions

**D1：增加显式交互事务入口和终结入口。**

新增 `synapse_start_interactive` 和 `synapse_finish_interactive`。`synapse_execute` 继续只接受结构化事务，已知交互式或已知会消费 stdin 的命令继续以 `INTERACTIVE_COMMAND_UNSUPPORTED` 拒绝；调用方应把 `sudo su -`、`vim`、`ssh` 等预期会等待输入的命令交给交互入口。交互入口仍执行字面 Shell 审计、保留标记检查和 Shell 方言校验，但不套用结构化入口专用的 `INTERACTIVE_COMMAND_UNSUPPORTED` 拒绝。工具面因此从五个增加为八个，新增的第三个工具是 `synapse_input`。

选择独立入口是为了保留 `synapse_execute` 的强不变量：拿到成功响应时，命令已经有一条不会被用户程序消费的完成证据路径。把交互模式塞进同一工具也可行，但会让默认行为、审批展示和完成状态更容易被调用方误用。

**D2：交互启动只写命令，完成 Probe 延后为独立操作。**

`synapse_start_interactive` 复用当前 environment Probe、执行上下文再验证、风险分类和审批流程；通过后只发送命令及其终止回车，不拼接完成 Probe。服务端可以先在 Session 队列中登记内部 attempt、输入授权和租约，但只有 `write()` 正常返回、表示本地 PTY 后端接受了写入调用，才向客户端创建并返回 transactionId 和 inputGrantId；这不证明远端程序已经消费完整命令。

`synapse_finish_interactive` 要求外部客户端先通过 `synapse_observe` 看到目标程序已经回到 Shell。服务端在同一 Session 串行队列中先原子地把事务标记为内部 `finishing`，再把带新 nonce 的完成 Probe 作为单独写入发送。收到匹配的 `osc_777` 帧后事务变为 `completed`；Probe 被目标程序消费、超时或 PTY 断开时变为 `unknown`。终结期间拒绝新的输入，防止输入落到下一个 Shell 提示符。

如果启动命令的 `write()` 已经开始调用，之后抛错，或后端明确表示无法判断命令是否交付，服务端不得返回一个客户端无法取得的事务句柄。该启动尝试返回 `INTERACTIVE_START_WRITE_UNKNOWN`，立即使当前 PTY environment 失效、递增 capability epoch、轮换 executionContextId、撤销未使用的 input grant 并释放交互租约；不自动重试 command。command 可能已经部分写入或执行，外部客户端必须先重新 observe，再由用户判断是否采取后续动作。服务端可以保留短生命周期的内部 attempt/tombstone 用于清理和并发收敛，但不得将其作为客户端事务，也不得持久化。

**D3：交互事务和结构化事务共享公开状态，但交互事务增加 kind。**

事务公开 `kind: structured | interactive`，状态仍只有 `running`、`completed`、`interrupted`、`unknown`。`finishing` 只作为内部阶段，不扩展已有公共状态枚举。`synapse_wait` 对交互事务只等待已经发生的终态，不主动发送 Probe；在未调用 finish 时，等待超时只返回 `running` 快照，不改变事务。

`synapse_interrupt` 可作用于两种事务。它只发送 PTY 的 Ctrl+C 并按既有语义结束为 `interrupted`；不声称远端进程或进程组已经终止。交互事务一旦进入 `finishing`，finish 取得终结权，interrupt 和 input 都不得再写入 PTY。

**D4：输入授权是独立能力，不继承普通审批的无限权限。**

事务内 `synapse_input` 必须同时携带 `transactionId`、`inputGrantId` 和调用方生成的 `inputRequestId`。

- `synapse_execute` 不产生后续输入授权。任何预期会读取 stdin 的 command 都必须通过 `synapse_start_interactive`，否则仍按结构化事务的 Probe 语义处理，不能声称交互安全；这避免在命令后排队的 Probe 被目标程序消费。
- `synapse_start_interactive` 必须显式选择 `inputGrantMode: "one_shot" | "bounded"`，并为交互事务签发绑定 Session、事务、调用方和用途的授权。`one_shot` 最多消费一次，适合单次提示；`bounded` 使用固定的总调用数、总字节数和空闲时限上限，适合编辑器或嵌套 Shell；两者都受单次 payload 上限约束。
- 授权校验、去重记录和 PTY 写入必须在同一 Session 串行顺序中完成。重复提交同一个 requestId 返回第一次调用的结果摘要而不再次写入；同一个 requestId 携带不同 payload 则拒绝。
- 事务终结、中断、不确定或清理时撤销剩余授权。原事务的 `allow_once` 只批准启动调用及其明确选择的有限档位，不能自动产生未声明的输入权限。

事务内输入不再弹出第二张审批卡片，也不把密码原文送入审批请求；它依赖启动调用明确产生的输入授权。自由输入仍按自己的调用内容走审批矩阵。

**D5：启动交互事务的审批按“长期可写入能力”处理。**

`read_only` 拒绝交互启动和自由输入。`managed` 对交互启动必须经过审批策略；未命中会话内放行记录时才弹审批卡片。卡片展示启动 command、选定的输入授权档位及其固定上限，但不展示未来输入。`full` 放行执行权，但输出仍经过脱敏。命令启动的 `allow_session` 匹配键为完整 command、执行模式和输入授权模式；自由输入的匹配键为规范化 text 与按序 keys。两类匹配键都不包含随机的 transactionId、grantId 或 requestId。

交互启动一旦成功就授予后续 PTY 写入能力，因此在 `managed` 下按长期可写入能力处理，不因启动 command 被分类为低危就套用普通低危写类的自动放行；只有命中同一完整授权键的会话内放行才免除审批。结构化 `synapse_execute` 仍沿用 ADR-0015 的风险矩阵，低危调用可以自动放行。

交互命令命中 `allow_session` 时，每次启动仍签发新的有限 inputGrantId；会话内放行记忆只免除同一授权键的再次审批，不把旧授权跨事务延长。

自由输入在 `managed` 下仍展示规范化后的待发内容和按键名，并按该表示做会话内精确匹配；这不改变“不保证秘密不进入 UI/历史”的边界。

**D6：输入协议先规范化、完整校验，再单次有序写入。**

规范化步骤固定为：

1. `text` 只允许可打印 Unicode 字符和 `\n`；将每个 `\n` 转换为 `\r`。`\r`、ESC、DEL、C0/C1 其他控制字符一律拒绝。
2. `keys` 只能来自固定枚举，并映射为固定的 xterm normal-mode 字节；禁止调用方携带转义序列或原始字节。
3. 计算规范化文本的 UTF-8 字节数、按键数量和合并 payload 的 UTF-8 字节数；任一超过服务端固定上限时，整次请求拒绝且不写入任何前缀。
4. 若文本为空且键序列为空，拒绝空 payload；该拒绝不消耗输入授权。
5. 通过校验后，将规范化文本和按键字节按“先 text、后 keys”的顺序拼成一个 payload，并在 Session 队列中调用一次后端 `write()`。

初始实现常量为：单次规范化文本最多 8 KiB、最多 128 个按键、合并 payload 最多 16 KiB；`one_shot` 授权最多一次输入，`bounded` 授权最多 256 次输入、累计 256 KiB、连续空闲 10 分钟。调用方不能通过参数放宽这些限制。只有首次通过完整校验并实际发起写入的请求才消耗输入配额；校验/审批拒绝和相同 requestId 的幂等重放不得重复扣减。`textLength` 表示规范化文本的 UTF-8 字节数，不是 JavaScript code unit 数量。

按键编码表如下；该表是协议的一部分，不声称能够协商目标程序的 application cursor/keypad 模式：

| key | bytes |
| --- | --- |
| `up` | `ESC [ A` |
| `down` | `ESC [ B` |
| `right` | `ESC [ C` |
| `left` | `ESC [ D` |
| `enter` | `CR` |
| `esc` | `ESC` |
| `tab` | `TAB` |
| `backspace` | `DEL` (`0x7f`) |
| `delete` | `ESC [ 3 ~` |
| `home` | `ESC [ H` |
| `end` | `ESC [ F` |
| `pageup` | `ESC [ 5 ~` |
| `pagedown` | `ESC [ 6 ~` |
| `space` | `SPACE` |
| `f1`–`f4` | `ESC O P`–`ESC O S` |
| `f5`–`f12` | `ESC [ 15 ~`, `ESC [ 17 ~`, `ESC [ 18 ~`, `ESC [ 19 ~`, `ESC [ 20 ~`, `ESC [ 21 ~`, `ESC [ 23 ~`, `ESC [ 24 ~` |

**D7：输入调用必须可安全重试，但不自动重放。**

`inputRequestId` 是当前应用运行期内、对同一调用方和 Session 唯一的逻辑输入标识，不透明且由调用方生成；它必须是 1 到 256 个字符且不含控制字符。服务端在完成调用方/Sharing/Session 校验和输入规范化后，必须先以 `(caller identity, sessionId, inputRequestId)` 定位去重记录，再比较该记录中的输入模式、适用的 `inputGrantId`（自由模式为空）和规范化 payload 的 SHA-256 摘要；不能把模式或 grant 放进主定位键而让同一 requestId 在另一模式下变成新请求。三者完全相同才直接返回第一次调用的结果，即使授权已消费或自由输入的 context 已轮换；任一不匹配都以 `POLICY_DENIED` 拒绝。新请求必须在任何 managed 审批等待或 PTY 写入前登记为处理中；重复请求只能等待或复用这个状态。去重记录只保存规范化 payload 的 SHA-256 摘要、已脱敏的发送元数据和结果摘要，不保存原始 text，并随当前 Sharing 关闭、Session 清理、token 撤销、端点关闭或应用重启销毁。后端 `write()` 没有回执时，调用成功只表示写入调用返回；如果调用抛错或无法判断是否交付，事务内输入将使所属事务进入 `unknown` 并返回 `INPUT_WRITE_UNKNOWN`，自由输入也返回该错误，客户端不得用新 requestId 重试。

**D8：事务句柄取代交互期间的执行上下文，终结后强制重新验证环境。**

交互启动仍必须校验当前 `expectedContextId`，并在 Probe、审批等等待阶段之后再验证。启动命令写入调用正常返回后轮换执行上下文，使旧的观察前提失效；若启动写入结果不确定，也必须立即失效环境并轮换 context/epoch。交互事务内的后续输入只校验 transactionId、inputGrantId 和 requestId，不逐次轮换 context，也不让自由输入绕过授权。

交互事务进入 `completed`、`interrupted` 或 `unknown` 后，Session 统一失效当前 PTY environment、递增 capability epoch 并轮换 executionContextId。下一次结构化执行必须重新 `synapse_observe`，再由执行管线运行 Probe。交互期间即使输入了 `cd`、进入嵌套 Shell 或 SSH，也不能把旧 environment 验证带到事务之后。

自由输入不属于任何事务：它要求当前 `expectedContextId`，校验通过后失效环境并轮换 context/epoch；存在活动事务时返回 `SESSION_BUSY`，必须改用事务内模式。

**D9：租约覆盖完整交互生命周期，本地用户优先。**

交互启动成功后持有 Session 外部租约直到终态、清理或空闲超时。启动写入不确定时也必须撤销内部授权并释放该租约。租约实现必须有明确的持有/释放语义，不能让同 caller 的重入输入提前释放外层租约。finish、interrupt、超时和 unshare 都必须幂等释放。

其他外部写入在租约期间返回 `SESSION_BUSY`。本地用户输入不被阻止；它会使活动交互事务进入 `unknown`、撤销授权并释放租约，用户输入本身仍按现有 `writeUser` 路径写入 PTY。

**D10：交互事务使用服务端空闲超时。**

连续无输入的时间达到固定空闲上限时，交互事务进入 `unknown`，授权和租约被撤销；`synapse_wait` 的单次 timeout 不影响该生命周期。超时、断开和清理都不可自动重放任何输入。

## Protocol Flows

### Starting an interactive transaction

1. 验证 Sharing、Session、PTY 状态和 caller。
2. 检查当前租约；Session 已有外部事务或外部审批等待时返回 `SESSION_BUSY`。
3. 使用当前 capability epoch 运行 environment Probe，并验证 `expectedContextId`；Probe 或审批等待后再次验证 context。
4. 对原始 command 做字面审计、Shell 方言检查和风险分类；交互启动不执行结构化入口的交互命令拒绝；在 `managed` 下按授权键检查会话内放行，未命中时进入审批卡片。
5. 在同一 Session 串行边界登记内部启动 attempt、输入授权和租约，然后只写入命令及终止回车。
6. `write()` 正常返回后，才向客户端返回 transactionId、inputGrantId、`kind: interactive`、`status: running`、输出窗口和当前游标。

写入前失败或 context 失效时不发送用户 command，也不返回事务 ID。若写入调用已开始但抛错或交付无法确认，返回 `INTERACTIVE_START_WRITE_UNKNOWN`，不返回可操作的事务/授权 ID，并执行环境失效、context/epoch 轮换、授权撤销和租约释放；启动命令不包含完成 Probe。

### Sending transactional input

调用方使用最近一次响应中的 transactionId 和 inputGrantId，并为每次逻辑输入生成唯一 inputRequestId。服务端先完成输入规范化并查询去重记录；命中相同摘要时直接复用既有结果。只有新 requestId 才在同一 Session 串行队列中检查事务仍为 `running`、授权仍有效、配额仍有剩余，再登记处理中、扣减配额并完成单次 PTY 写入。

事务内输入不改变 executionContextId 或 capability epoch，也不创建新的事务。响应返回所属事务快照、`sent` 元数据、固定 300ms 即时输出窗口和 nextCursor；不返回文本原文。

### Finishing an interactive transaction

调用方先用 `synapse_observe` 确认目标程序已经退出并回到 Shell，再调用 `synapse_finish_interactive`。服务端原子地从 `running` 切换到内部 `finishing`，拒绝后续 input，然后单独写入完成 Probe。调用方必须携带该次观察返回的 `nextCursor` 作为 `observedCursor`；服务端只校验游标属于当前 Sharing 且不早于最近一次输入的输出位置，不尝试解析提示符语义。调用方若省略或传入过旧、跨 Sharing 的游标，finish 在写入 Probe 前以 `OUTPUT_CURSOR_STALE` 拒绝。

- 收到匹配 nonce 的完成帧：返回 `completed`、退出码和输出范围。
- Probe 被目标程序消费、未在固定等待时限内返回或 PTY 退出：返回 `unknown`，`retryable: false`、`safeToResubmit: false`。
- finish 自身只允许用于 `kind: interactive` 的活动事务；结构化事务使用既有 `synapse_wait`/`synapse_interrupt`。同一交互事务的并发 finish 请求必须共享第一次 finish 的结果，不得发送第二个 Probe；finish 已进入终态后不得重新发送 Probe，调用方应使用 `synapse_wait` 读取已保存结果。

### Free input

没有活动外部事务时，调用方可以使用 `expectedContextId` 发送输入。该调用不创建 transactionId，也不产生 `wait`/`interrupt` 句柄；它按自由输入审批矩阵执行，并在进入后端写入尝试的同一 Session 队列边界失效 environment、轮换 context/epoch；成功响应返回新的 executionContextId，交付不确定时也不得保留或复用旧 ID。下一个自由输入或结构化命令必须重新 observe 后使用新 ID，活动事务期间则一律拒绝。

## Response Contract

所有 `synapse_input` 响应都包含：

```json
{
  "sent": {
    "textLength": 7,
    "keys": ["enter"],
    "payloadBytes": 8
  },
  "output": "...",
  "nextCursor": "..."
}
```

`textLength` 和 `payloadBytes` 是规范化后的 UTF-8 字节数；`keys` 只含键名。响应可附带 `redacted`、截断状态和事务输出范围。事务内模式附带 transaction 快照，自由模式附带新的 executionContextId。任何模式都不得返回 `text` 原文、原始 PTY 字节、Probe 原文或屏幕快照。

即时输出窗口固定为服务端约 300ms；窗口为空不表示输入失败，完整事实仍通过 `synapse_observe` 输出分页取得。

## Error Semantics

- 缺少或失效 `expectedContextId`：`EXECUTION_CONTEXT_REQUIRED` / `EXECUTION_CONTEXT_STALE`，不得写入。
- 活动事务、finish 竞态或租约不可用：`SESSION_BUSY`，不得写入。
- 事务不存在、已终态或不属于当前 Sharing：`TRANSACTION_NOT_FOUND`。
- 输入授权缺失、过期或额度耗尽：`INPUT_GRANT_EXHAUSTED`，不得写入；重复的已知 requestId 在授权检查前返回原结果。
- 输入为空、超过限制、包含控制字符或键名不在白名单：`COMMAND_NOT_AUDITABLE`，不得写入任何前缀，也不得消耗输入授权。
- 事务内或自由输入的后端写入交付无法确认：`INPUT_WRITE_UNKNOWN`；事务内模式同时将事务置为 `unknown`，不得自动重试。
- 交互启动写入调用已开始但抛错或交付无法确认：`INTERACTIVE_START_WRITE_UNKNOWN`；不得返回 transactionId/inputGrantId，必须失效环境、轮换 context/epoch、撤销授权并释放租约，command 可能已经部分写入或执行，客户端不得自动重试。
- 交互 finish 被调用于结构化事务：`POLICY_DENIED`，指引使用 `synapse_wait` 或 `synapse_interrupt`。
- finish 缺少、过旧或跨 Sharing 的 `observedCursor`：`OUTPUT_CURSOR_STALE`，指引先重新 observe 后再终结。
- 交互空闲超时、Session 清理或 PTY 断开：事务为 `unknown`，释放授权和租约，不自动重放。

## Standard Call Sequences

### Sudo or another password prompt

```text
observe -> start_interactive("sudo su -", inputGrantMode: "bounded")
        -> observe password prompt
        -> input(transactionId, inputGrantId, inputRequestId, text: "<password>\n")
        -> observe root-shell prompt
        -> input(..., text: "exit\n")
        -> finish_interactive(transactionId, observedCursor: C2)
        -> wait(transactionId)
```

密码只作为调用参数进入 PTY；服务端响应不回显它。是否出现在 PTY 回显、Sharing 输出历史或本地 UI 不由该保证覆盖。

### Vim

```text
observe -> start_interactive("vim notes.txt", inputGrantMode: "bounded")
        -> input(..., text: ":wq\n")
        -> observe Shell prompt (returns C2)
        -> finish_interactive(transactionId, observedCursor: C2)
```

### User-started bastion menu

```text
用户先在本地 PTY 进入菜单
observe -> input(expectedContextId: C1, inputRequestId: I1, keys: ["down", "down"])
        -> input(expectedContextId: C2, inputRequestId: I2, keys: ["enter"])
```

每次自由输入都返回新的 context；自由输入不是交互事务的启动方式。

## Risks / Trade-offs

- 显式 start/finish 增加了两个工具和调用步骤，但避免了把完成 Probe 误送给交互程序。
- finish 依赖外部客户端观察到 Shell 提示符；调用方过早 finish 可能让 Probe 被目标程序消费并进入 `unknown`，这是比错误报告成功更安全的结果。
- 有限输入授权降低了审批范围扩大风险，但不能判断输入的业务语义，也不能阻止被授权程序自行解释文本；`bounded` 仍代表用户把该交互程序的 stdin 控制权交给外部客户端一段有限时间。
- `TerminalBackend.write()` 无交付回执；单次调用减少了重排和部分协议校验风险，但仍不能证明远端程序已消费全部字节。
- 固定 xterm normal-mode 编码不能覆盖所有 application mode；需要其他键盘方言时应新增明确协议，而不是开放原始转义序列。
- PTY 回显可能包含密码；本变更诚实收窄了秘密保证，后续若要隐藏 Sharing 历史需要独立的端到端秘密输入设计。

## Migration Plan

旧五个工具的输入和成功语义不变。旧客户端继续使用 `synapse_execute`、`synapse_observe`、`synapse_wait`、`synapse_interrupt` 和 `synapse_status`；需要交互的客户端改用八工具 Surface 中的 `synapse_start_interactive`、`synapse_input` 和 `synapse_finish_interactive`。

实现顺序必须先完成 Session/事务状态机和 Shell Driver 的独立写入协议，再暴露 MCP 工具；不能先注册 `synapse_input` 而让它写入尚未建立活动句柄的事务。回滚时移除三个新增工具和交互执行器即可，不产生持久化状态。

## Open Questions

无。上限、空闲时间和输入去重的边界已作为服务端固定契约记录；若实现阶段需要改变数值，应同步更新 spec、测试和工具描述。
