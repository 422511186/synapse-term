## Why

外部客户端通过 MCP 驱动终端时，真实场景不只是在 Shell 提交一条可等待完成的命令，还包括密码提示、编辑器、堡垒机菜单和交互式 REPL。现有 `synapse_execute` 会把用户命令和完成 Probe 拼成一次 PTY 写入；对会读取 stdin 的程序，Probe 可能被程序当作输入消费，因此不能用它启动持续交互。

当前提案把“增加一个 PTY 写入方法”和“建立可持续的交互事务”混在了一起，并让普通命令的审批结果隐式继承到任意后续文本。这会同时破坏完成证据和 `allow_once` 的单次调用语义。本变更改为显式区分结构化执行和交互事务，保留现有安全边界。

## What Changes

- 外部工具面从五个扩展为八个：新增 `synapse_start_interactive`、`synapse_input` 和 `synapse_finish_interactive`。
- `synapse_execute` 保持结构化外部事务语义：继续附加独立完成 Probe，并继续拒绝已知交互式或已知会消费 stdin 的命令。需要输入的命令必须显式选择交互事务入口；无法静态识别的命令仍不因此获得自动交互保证。
- `synapse_start_interactive` 在当前执行上下文通过环境 Probe、风险判断和审批后，只把启动命令写入 PTY，不在同一次写入中附加完成 Probe。它仍执行字面 Shell 审计和 Shell 方言校验，但允许 `synapse_execute` 因交互性质而拒绝的已知 command；只有 `write()` 正常返回、表示本地 PTY 后端接受了写入调用后才返回交互事务 ID 和输入授权 ID。
- `synapse_input` 仍是输入工具，但事务内模式必须携带与交互事务绑定的 `inputGrantId`；`synapse_start_interactive` 必须显式选择 `one_shot` 或 `bounded` 输入授权档位。原启动调用的 `allow_once` 不再自动授权无限后续输入，`synapse_execute` 不提供后续 stdin 输入能力。
- `synapse_input` 的自由模式保留给没有活动外部事务的 Session：调用方必须提供当前 `expectedContextId`，进入 PTY 写入尝试时即失效当前环境并轮换上下文，即使交付不确定也不得复用旧 ID。自由模式不能启动交互事务，也不能绕过活动事务的输入授权。
- `synapse_finish_interactive` 只在外部客户端已经观察到程序回到 Shell 后使用；服务端把终结 Probe 作为独立的后续 PTY 写入，并等待有效完成帧。Probe 被交互程序消费、超时或 PTY 断开时，事务进入 `unknown`，不得自动重试。
- 所有输入请求都携带调用方生成的 `inputRequestId`。服务端在当前应用运行期去重，只保留规范化 payload 的 SHA-256 摘要和已脱敏结果摘要；重试时先命中去重记录，不因授权已消费或 context 已轮换而再次发送密码或按键，不确定的后端写入不得用新的 ID 盲目重放。
- 输入协议先规范化和完整校验，再以一次有序的 PTY 写入提交：`text` 中的换行转换为回车，特殊键来自固定白名单，禁止任意转义序列和原始字节。空文本与空键序列组成的空 payload、以及超出文本、按键或合并 payload 上限的请求，都整次拒绝，不写入部分内容或消耗输入授权。
- 输入响应只报告规范化后的文本字节数、按键名、输出窗口和游标，不回显 `text` 原文。这个保证只覆盖工具响应；PTY 回显、终端 UI、Sharing 输出历史和审批卡片仍可能显示输入内容。
- 交互事务持有 Session 外部租约。其他外部写入返回 `SESSION_BUSY`；本地用户输入始终可用，但会使交互事务进入 `unknown` 并撤销其输入授权。
- 交互启动若在写入调用已经开始后抛错，或 PTY 后端无法判断启动命令是否交付，返回 `INTERACTIVE_START_WRITE_UNKNOWN`；不向客户端返回可用于 `input`/`finish` 的事务或授权 ID，立即失效当前 PTY environment、递增 capability epoch、轮换 executionContextId、撤销未使用授权并释放租约。启动命令可能已经部分写入或执行，系统不得自动重试，客户端必须先重新 observe 并由用户判断。
- 移除无法被客户端稳定利用的 `TRANSACTION_NOT_ACTIVE`；事务 ID 只在启动命令写入调用正常返回后对外可见。

## Capabilities

### Modified Capabilities

- `mcp-access`：增加交互事务生命周期、受限输入授权、输入去重和八工具 Surface；保留结构化事务的完成 Probe、执行上下文校验、审批模式和输出脱敏契约。

## Impact

- `packages/domain/src/external/external-caller.ts`：补充交互事务和输入协议所需的公共类型；稳定错误码增加输入授权耗尽、输入写入不确定和交互启动写入不确定错误，不新增 `TRANSACTION_NOT_ACTIVE`。
- `packages/terminal-service/src/shell/shell-driver.ts`：把“只发送命令”和“发送完成 Probe”建模为两个独立操作；结构化命令继续使用合并前后可验证的现有路径。
- `packages/terminal-service/src/session/session-actor.ts`：增加带上下文校验的交互启动写入、事务内输入和自由输入写入，并保证每个操作进入同一 Session 串行队列。
- `packages/terminal-service/src/session/command-executor.ts` 或新的交互事务执行器：维护交互事务的 `running`、内部 `finishing`、`completed`、`interrupted` 和 `unknown` 生命周期；处理输入授权、终结 Probe、去重和超时。
- `packages/terminal-service/src/session/external-lease.ts`：支持跨多次输入调用持有租约，并在事务终态、清理或空闲超时后可靠释放。
- `apps/desktop/src/main/mcp/external-tool-pipeline.ts`：新增 start/input/finish 管线、审批授权、输出窗口和稳定错误映射。
- `apps/desktop/src/main/mcp/mcp-tools.ts`、`mcp-controller.ts`：注册八个工具、校验输入、分发调用并同步工具描述。
- `apps/desktop/src/main/mcp/approval-queue.ts`、`apps/desktop/src/renderer/mcp/approval-card.tsx`：让交互启动审批显示授权档位和固定上限，并保持会话内放行键的精确匹配。
- `apps/desktop/src/renderer/mcp/share-text.ts`：同步八工具清单和三类交互事务调用顺序。
- 测试：覆盖真实交互式 Bash/PTY 中 Probe 不被启动命令消费、授权边界、finish 竞态、重试去重、输入编码、输出脱敏和 HTTP 工具 Surface。
- 文档：修订 ADR-0019 和 `CONTEXT.md`，使交互事务、输入授权槽和秘密输入保证与实现边界一致。

## Resolved Design Constraints

- 交互程序必须通过显式交互事务启动；`synapse_input` 自由模式只驱动已经存在的 PTY 状态，不负责猜测程序语义。
- 交互事务必须显式终结或中断；系统不通过脆弱的 Shell 提示符启发式自动收敛。
- 交互期间输入依赖事务句柄和有界输入授权，不逐次轮换执行上下文；终结、打断或不确定后失效环境，后续结构化执行必须重新观察并 Probe。
- `allow_once` 仍只批准当前外部调用。交互输入授权是启动调用明确选择档位后产生的、绑定事务的有限能力，不是原审批的无限继承。
- `managed` 下交互启动按长期可写入能力处理；未命中同一完整授权键的会话内放行时需要审批，结构化 `synapse_execute` 仍沿用 ADR-0015 的风险矩阵。
- 输入或交互启动写入成功只表示本地 PTY 后端的 `write()` 调用正常返回；当前 `TerminalBackend.write()` 没有交付回执，因此不承诺远端程序已经消费完整 payload。启动写入抛错或交付无法确认时，系统返回 `INTERACTIVE_START_WRITE_UNKNOWN`、撤销句柄并要求重新观察，绝不自动重试。

## Migration Plan

这是一个新增协议能力，不改变旧工具的成功调用格式。旧客户端继续使用原五个工具；需要驱动 stdin 的客户端改为：先调用 `synapse_start_interactive` 并显式选择输入授权档位，用返回的 `inputGrantId` 调用 `synapse_input`，观察到回到 Shell 后调用 `synapse_finish_interactive`。在实现完成前，现有 ADR-0019 初稿、delta spec 和 Share Text 必须同时更新，避免出现“工具已声明但调用顺序仍指向旧模型”的中间状态。

回滚只需移除三个新增工具及交互事务执行器；不持久化事务、输入授权或去重记录，不留下应用重启后的状态残留。
