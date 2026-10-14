# Design

## Context

动机见 `proposal.md` 的 Why，需求见 delta spec。这里只记录塑造方案的现状事实：

- `SessionActor`（`packages/terminal-service/src/session/session-actor.ts`）有 7 个写入方法：外部族 `writeExternal`、`writeInteractiveStart`、`writeTransactionalInput`、`writeFreeInput`、`writeInteractiveFinishProbe`，以及本地通道的 `writeUser` / `writeProbe`。
- 外部族共用一套「未释放 → PTY 运行中 → environment 已验证 → capability epoch 匹配 → executionContextId 匹配」阶梯，但只有 `writeInteractiveStart` 通过 `#validateGuardedExternalWrite` 使用它，其余三处逐字重写。
- 结果类型已经分叉：`GuardedExternalWriteResult` 包含 `write-unknown`，而 `writeExternal` 永远不返回它；`InteractiveInputWriteResult` 不包含 `stale-*` 与 `environment-unverified`。
- `CommandExecutor.#dispatch`（`command-executor.ts`）的 catch 用 `run.sent` 区分「写入前失败」与「写入后不确定」，但 `run.sent` 只在写入正常返回后置位，`#finish` 又带 `!run.sent` 守卫，因此写入抛错必然落到 `SESSION_NOT_READY`。
- 交互启动路径对同一物理事件的处理相反：`interactive-command-executor.ts` 把写入抛错转成 `INTERACTIVE_START_WRITE_UNKNOWN` 并置 `run.environmentInvalidated`。
- 「前提码 → `ExternalErrorCode`」的映射存在三份：`command-executor.ts` 的 `writeError`、`interactive-command-executor.ts` 的 `startWriteError` / `inputWriteError`、`external-tool-pipeline.ts` 自由输入分支的内联映射。
- `domain/src/session/session-state.ts` 已经拥有 `SessionState` 的纯状态转换（`verifySessionEnvironment`、`invalidateSessionEnvironment`、`replaceSessionExecutionContext`）。
- 稳定错误码集合在 `mcp-tools.ts` 与 `external-tool-pipeline.ts` 各维护一份字面重复的列表。

## Goals / Non-Goals

**Goals:**

- 外部写入族的 Interface 从 5 个方法收敛为 1 个，前提与后果成为数据，不变量只有一个维护点。
- 结构化执行的写入不确定态与交互启动同构，且不松动「事务 ID 只在写入正常返回后可见」这条已生效规则。
- 前提判定成为可表驱动测试的纯函数；副作用仍然只通过 `SessionActor` 的真实 Interface 验证。
- 前提码到外部错误码的映射只有一个实现。

**Non-Goals:**

- 不引入新的跨进程 seam、Port 或 Adapter；本次不产生第二个 Adapter。
- 不改 Renderer、preload 与 IPC 契约，不改 `DesktopApi`。
- 不改事务内输入与自由输入的对外错误码（已知边界的取舍见 Decision 10）。
- 不把 `ExternalWriteGuard` 换成 `AbortSignal`：只有一个取消观察点，换成标准库对象只增加 controller 生命周期，等出现第二个观察者再换。
- 不把前提码到外部错误码的映射搬进 `domain`；那属于另一个变更的方向，混进来会说不清本次边界。

## Decisions

### 1. Seam 留在 `SessionActor` 的公共方法上，只收敛 Interface

外部族收敛为一个写入方法，本地通道保留 `writeUser` / `writeProbe` 两个具名方法，三者共用同一前提助手与写入后果处理。落地后的 Interface：

```ts
// packages/domain/src/session/session-state.ts
type WritePrecondition = 'environment-and-context' | 'environment' | 'context' | 'session';

type WritePremise =
  | { precondition: 'environment-and-context'; environmentEpoch: number; executionContextId: string }
  | { precondition: 'environment' }
  | { precondition: 'context'; executionContextId: string }
  | { precondition: 'session' };

// packages/terminal-service/src/session/session-actor.ts
interface WriteRequest {
  data: string;
  premise: WritePremise;
  effects?: WriteEffects;
  cancelled?: () => boolean;
}

type WriteResult =
  | { ok: true; executionContextId: string; environmentInvalidated: boolean }
  | { ok: false; error: WriteError; environmentInvalidated: boolean };
```

- 相对草案的两处调整：`precondition` 与期望值合成判别联合 `premise`，让调用方无法漏传该前提需要的字段；新增 `session` 前提，因为本地通道只要求「Session 未被释放且 PTY 在运行」，既不是 `environment`（要求已验证）也不是 `context`（要求上下文匹配）。
- 写入抛错的处理方式不在 `WriteRequest` 上：它是 `#writeGuarded` 的私有参数，公开的 `writeExternal` 一律 `uncertain`，本地通道传 `propagate`。第一刀曾用公开字段表达这个差异作为过渡；第二刀落地时发现本地通道的差异是长期的（没有事务承载不确定态），把它留在公开 Interface 上会让它变成一个多余词汇，于是下沉为私有参数。
- **为什么不保留五个具名方法**：Q2 落地后 `writeExternal` 与 `writeInteractiveStart` 逐位相同，`writeTransactionalInput` 与 `writeInteractiveFinishProbe` 逐位相同，五个名字只会让调用方继续背「哪几个共享哪些前提」，而两类结果类型的分叉正是漂移的入口。
- **为什么不把本地通道并进同一 Interface**：调用方必须理解「用户通道 vs 外部通道」的信任级别差异，合并会糊掉安全边界。本地通道的窄结果类型（只有 `session-not-running`）也是对事实的准确描述。
- **为什么不加一层 Port**：只有一个 Adapter（node-pty），按「一个 Adapter 是假 seam」的纪律不引入。

### 2. 前提/后果策略表放在 `domain`，且只有一份

表放在 `packages/domain/src/session/session-state.ts`，共 3 行；「写入尝试发起后抛错 → 失效 environment ＋ 递增 epoch ＋ 返回 `write-unknown`」是统一后果，不入表。

| precondition | 要求 environment 已验证 | 要求 epoch 匹配 | 要求 executionContextId 匹配 | 写入前失效 environment | 写入后轮换 context |
| --- | --- | --- | --- | --- | --- |
| `environment-and-context` | 是 | 是 | 是 | — | 是 |
| `environment` | 是 | — | — | — | — |
| `context` | — | — | 是 | 是 | — |

- 实现时发现的修正：原计划把表放在 `SessionActor` 的模块级常量。但 Decision 7 的前提判定纯函数必须读「各前提要求哪些校验」，而后果标志由 `SessionActor` 执行；若按包切开，同一张表会被拆到两个 Module，重新制造本次要消除的无 locality。表因此整体落在 `domain`，由状态的既有转换词汇表达后果。
- **替代：放在 `SessionActor` 的模块级常量**——否决，理由同上（拆表）。
- **替代：作为构造函数参数注入**——否决，只有一个 Adapter 的假 seam。

### 3. `precondition` 按前提命名，不按调用方命名

三值命名直接说清「这条写入要求什么」，而不是「哪个调用点用它」。调用点映射：`CommandExecutor` 与交互启动用 `environment-and-context`；事务内输入与终结 Probe 用 `environment`；自由输入用 `context`。

- **替代：保留五个调用点名字**——会让三行重复藏在名字后面。
- **替代：只合并其中一对**——剩下的一对仍要人肉比对。

### 4. 统一结果类型并显式携带环境后果

成功与失败都带 `environmentInvalidated`。

- 理由：`context` 前提的成功结果就是「environment 已被失效」，调用方不该按 `precondition` 反推；今天三个调用点各写一遍 `write.error === 'write-unknown'` 的推断。
- **替代：`environmentOutcome: 'intact' | 'invalidated' | 'rotated'`**——`rotated` 与返回值里的 `executionContextId` 是重复信息。

### 5. 写入尝试发起后的抛错即不确定态

写入抛错一律失效 environment、递增 capability epoch、轮换 executionContextId，并返回 `write-unknown`，五个调用点一致。

- **替代：保留「`write()` 抛错即未写入」**——node-pty 可能在部分交付后失败，抛错不构成「未写入」的证据；ADR-0018 对「PTY 在完成证据到达前断开」的判定也是不确定态，两条路径对同一事件不该给相反结论。

### 6. 结构化执行的对外形态是错误码，不是可见事务

`CommandExecutor` 的写入抛错分支改走 `EXECUTION_WRITE_UNKNOWN` 失败路径：不返回 transactionId、不产出可见事务，`run.sent` 语义与 `#finish` 的 `!run.sent` 守卫保持不变。落地方式是复用既有的 `#rejectBeforeSend`：不发出 `started` 事件、不写入历史、清空活动事务，客户端只收到该错误码。

- **替代：把 `sent` 重新定义为「写入尝试已开始」并产出 `status: unknown` 的事务**——否决。那会松动「事务 ID 只在 `write()` 正常返回后可见」这条已生效规则，而错误码已经能承载「可能已执行、不可自动重试、需要用户判断后续动作」，不必额外造一个可见事务。
- 依赖：新增稳定错误码要同时改 `domain` 的 `ExternalErrorCode` 与两份字面重复的集合；把它们收成同一个常量与 Decision 8 同批完成。

### 7. 前提判定是 `domain` 的纯函数，取消与已释放事实由调用方求值后传入

在 `domain/src/session/session-state.ts` 增加一个纯判定函数，输入 `SessionState`、前提描述（`precondition` 加可选的期望 `environmentEpoch` 与 `executionContextId`）以及「是否已释放 / 是否已取消」两个布尔事实，输出前提错误码或空。`SessionActor` 在自己的串行队列内求值取消回调，再作为布尔传入，纯函数因此不持有回调。

- `disposed` 必须显式传入：`SessionActor.dispose()` 不改变 `SessionState.pty`，所以「已释放」不是 `SessionState` 上的事实，但它在当前实现里映射为 `session-not-running`，不能并入取消事实。
- 判定顺序必须与现状一致：已取消 → 未运行/已释放 → environment 未验证 → epoch 不匹配 → executionContextId 不匹配。
- **替代：放在 `terminal-service`**——`precondition` 按 Decision 3 改成按前提命名后，判定完全落在 `SessionState` 的既有事实（`pty`、`environment`、`executionContextId`）上，没有新词汇。
- **替代：新建 `domain/src/session/write-premise.ts`**——触发条件是 `session-state.ts` 超过约 200 行。
- 测试面：纯函数表驱动覆盖三档前提 × 状态组合；`SessionActor` 的测试只保留副作用断言（轮换后 id 变化、写前失效、抛错的失效后果、串行写序）。理由是本处 bug 类别落在判定本身，不落在调用顺序上——与「抽了纯函数但 bug 在顺序里」的反例不同，副作用因此必须继续穿过真实 Interface。

### 8. 前提码到外部错误码的映射合并到 `terminal-service` 内一处

三份映射合并为 `packages/terminal-service/src/session/write-error-mapping.ts`：`PREMISE_ERROR_CODES` 是「前提码 → `ExternalErrorCode`」的唯一定义，`describeStructuredWriteError` / `describeInteractiveStartWriteError` / `describeTransactionalInputWriteError` 返回 `{ code, reason, guidance }`，`CommandExecutor` 与 `InteractiveCommandExecutor` 只把描述包进各自的错误类。

- **措辞不合并**：原因与指引文本描述的是「哪条写入形状的上下文」（结构化执行 / 交互启动 / 事务内输入），合并成一份会丢掉这个上下文，而且不是「映射」的一部分。映射（错误码判定）只有一份。
- 实现时确认了两处**必须保留**的代码差异：事务内输入把 `session-not-running` 报为 `INPUT_WRITE_UNKNOWN`（其余形状报 `SESSION_EXPIRED`），`write-unknown` 只出现在交互路径。抹平它们会改变对外错误码，违反第一刀「无可观察变更」的约束，因此在同一处显式记录而不是消除。第 2 刀为结构化执行引入 `EXECUTION_WRITE_UNKNOWN` 后，这两处差异仍然成立。
- 附带：`inputWriteError` 增加显式处理 `environment-unverified` 的分支（描述与旧的「`external-write-cancelled` ＋ 环境已失效」完全一致），并把调用方参数从 `run.environmentInvalidated || verificationStatus !== 'verified'` 收回到 `run.environmentInvalidated`。
- **替代：搬进 `domain`**——那是「让领域输出结构化结论」另一条路线，属于别的变更。
- **替代：把自由输入的内联映射也搬过来**——它在 `mcp-runtime`，返回值是管线层的 `denied` 结果而不是错误类；`ExternalToolPipeline` 只能通过 `terminal-service` 的公共出口使用，搬过去会引入反向依赖。

### 9. 两刀交付

- **第一刀（纯重构）**：新增纯函数与前提判定；`SessionActor` 外部族收敛为表驱动；本地通道共用助手；三处映射合并；`interactive-command-executor` 的前提码归一（`external-write-cancelled` → `environment-unverified`）与 `inputWriteError` 的显式分支。对外结果不变，因此第一刀**不产生**新的规格行为。
- **第二刀（行为变更）**：写入抛错统一为不确定态、`EXECUTION_WRITE_UNKNOWN`、两份错误码集合合一、`CommandExecutor` 的抛错分支改判，并删除 `writeFailure` 过渡字段。
- 已核实：`external-write-cancelled` 与 `environment-unverified` 都没有被任何测试直接断言，所以第一刀不需要改测试断言——这同时是「第一刀对外不可见」的证据，也说明原先预期要改的两处断言并不存在。（接口收敛本身仍需要把测试调用迁移到新签名，1.5 的对照结论记录了这一点。）

### 10. 已知边界：事务内输入的错误码措辞不修

`interactive-command-executor.ts` 把「写入前被拒（Session 不再运行或 environment 未验证）」与「写入已成功但 environment 已失效」都映射为 `INPUT_WRITE_UNKNOWN`，而前者的输入**肯定没有**写入、后者的输入**肯定已经**写入。

不修的理由：这两条路径都会立刻把事务收敛为 `unknown`，客户端拿不到重放窗口，`INPUT_WRITE_UNKNOWN` 传达的动作指令（不要重放、重新 observe）是正确的，不精确的只是标签；修正需要新增错误码并改动事务内输入的对外契约，超出本变更的目的。此边界记录在案，由后续变更处理。

## Risks / Trade-offs

- [外部客户端依赖以 `SESSION_NOT_READY` 判断「用户命令肯定未写入」，行为会改变] → 错误文本同时给出原因与不可自动重试的指引；在 `CONTEXT.md` 与 ADR 中记录该语义；不静默兼容为旧码。项目处于单用户本地边界，外部客户端为已知的本机程序，可接受一次性破坏。
- [纯函数抽取后判定不再穿过 `SessionActor`，可能掩盖调用顺序问题] → 副作用断言必须继续穿过真实 Interface（Decision 7）；纯函数测试只覆盖判定，不覆盖写序。
- [「第一刀对外不可见」是一个需要证据的声明] → 已核对：受影响的两个码（`external-write-cancelled`、`environment-unverified`）不在任何测试断言中，且 `CommandExecutor` 的映射不经由它们；第一刀后逐项对照三条调用路径的外部错误码。
- [与进行中的 `add-terminal-file-transfer-and-status` 在 `SessionActor` 写入入口重叠] → 见 `proposal.md` 的冲突提示。先落地者为另一者提供宿主：本变更先落地会给出写入策略表入口；操作槽先落地则本变更的策略表挂到操作槽上。
- [写入抛错后失去「未写入」的确定结论，若 PTY 实际未写入，客户端会多做一次 observe 与 Probe] → 该代价低于重放一条可能已经执行的命令。

## Migration Plan

- 两步提交，无数据迁移、无持久化状态、无 IPC 契约变更。回滚即 revert 对应提交，第一刀与第二刀可独立回滚。
- 安全停止条件：第一刀完成后逐项对照对外错误码；若发现任何变化，说明重构不纯，停止并修正后再进入第二刀。
- 文档闭环：`CONTEXT.md` 的「事务不确定态」补充「包含写入尝试本身未取得交付确认」；新增 ADR 记录写入不确定态的统一判定，并在 ADR-0018 标注接管关系。以上由 tasks 承担。
