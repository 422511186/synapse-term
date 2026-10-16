# Design

## Context

动机见 `proposal.md` 的 Why。这里只记录塑造方案的现状事实：

- 两个执行器各持 `#active`；`ExternalLeaseRegistry` 是 caller 粒度的第二权威；`ExternalToolPipeline` 用 `activeTransactionId` / `activeTransactionKind` / `#hasExternalActivity()` 把三者合成。
- 「一个 Session 同时只允许一个外部事务」在 5 处被表达：pipeline 的前置门、租约注册表的异主拒绝、`CommandExecutor.execute` 的 `#active` 检查、`InteractiveCommandExecutor.#start` 的 `#active` 检查、pipeline `interrupt` 的跨事务拒绝。
- 输入幂等有两处实现：pipeline `#inputRequests`（键含 `caller.kind` 与 `sessionId`）与 `InteractiveCommandExecutor.#inputHistory`（键只含 `callerId` 与 `requestId`）；`ActiveRun.inputRecords` 只写不读。两处都满足 `specs/mcp-access/spec.md` 第 244 条的检查顺序（去重先于配额与 `expectedContextId`）。
- 输入授权上限有两份常量：pipeline 的 `inputGrantLimits(mode)`（供审批卡片展示）与 `InteractiveCommandExecutor` 内硬编码的上限。
- 每份 Sharing 的组合点是 `McpController.share()`：它在那里创建 `SharingOutputHistory`、`CommandExecutor`、`ExternalLeaseRegistry` 与 `ExternalToolPipeline`；pipeline 再创建 `InteractiveCommandExecutor`。
- 三个测试文件各自复制一套 `createHarness`。

## Goals / Non-Goals

**Goals:**

- 让「本 Session 有活动外部事务」与「输入请求幂等」各成为单一权威，读它们只经一个 Interface。
- 对外的 `SESSION_BUSY` 判定只由一处表达。
- 审批卡片展示的输入上限与执行器实际执行的上限同源。
- 严格不改变任何外部可观察行为。

**Non-Goals:**

- 不做行为修正，包括 `#hasExternalActivity()` 把「审批中但尚未成为事务」的调用也算作活动事务这一疑点（需要单独评估它是有意占位还是实现副产品）。
- 不动 pipeline 的会话内放行（审批策略，按 ADR-0020 属 `mcp-runtime`）。
- 不合并三个测试文件的 harness（新账本是纯注册表，不需要重型 harness；硬塞会让 diff 意图不清）。
- 不改 `SessionActor`、不改 IPC 契约、不产生 delta spec。

## Decisions

### 1. 两个独立 Module，各自一个 Interface

活动事务账本与输入请求账本分成两个 Module，不合并。理由是生命周期不同：事务账本条目随事务终态注销，而输入请求账本条目**必须活过事务终态**（`specs/mcp-access/spec.md` 第 207 条：已登记且已完成的相同 requestId 在事务终态后仍要只读返回缓存结果）。合并会让「何时注销」变成需要分支的问题。

- **替代：一个 Module 承载两者**——否决，理由同上。

### 2. 活动事务账本：持有存在性与身份，不持有状态

Interface 草案：

```ts
export interface ExternalTransactionEntry {
  kind: 'structured' | 'interactive';
  transactionId: string;
  /** 结构化执行允许不携带调用方身份，因此 caller 可选。 */
  caller?: ExternalCaller | undefined;
  /** 事务状态的唯一权威仍在执行器；账本只借它回答查询。 */
  status(): ExternalTransactionStatus;
}

export class ExternalTransactionLedger {
  open(entry: ExternalTransactionEntry): void; // 已有条目时抛错
  close(transactionId: string): void;
  get active(): ExternalTransactionEntry | undefined;
}
```

- 账本不复制状态值。若账本持有状态并在状态变化时写回，就会把候选 #1 刚消掉的「同一事实两处维护」重建一次；若把 `ActiveRun` 整个搬进账本，账本会变成什么都装的神对象，并把执行器的内部运行态暴露成公共 Interface。
- **注销点 = 事务终态**。条目消失后「查某个事务」仍走执行器既有的 `get()` 与历史快照，行为不变；因此 `status()` 只在条目存活期间被调用，不需要为「事务已消失」定义返回。

### 3. 租约保持独立 Module

租约是 caller 粒度（「外部调用在飞」，包含仍在审批等待、尚未成为事务的调用），账本是 transaction 粒度。合并会把两种事实压成一个，反而丢信息；而租约的异主拒绝本身是 spec 要求的并发保护。账本在回答「是否有外部活动」时统一询问租约，但两者不共享存储。

### 4. 组合根是 `McpController.share()`

两个账本由 `McpController.share()` 创建，与 `history`、`leases`、`executor`、`pipeline` 并列；通过构造参数注入 `CommandExecutor`（只需事务账本）与 `ExternalToolPipeline`（两个都注入，再由它转交 `InteractiveCommandExecutor`）。

- 事务账本必须早于两个执行器存在，而 `CommandExecutor` 在 pipeline 之前构造，所以构造点只能上移到组合根。
- **替代：由 pipeline 构造并向 `CommandExecutor` 注册**——否决。那会让「事务存在性」的写入经事件或回调异步到达账本，而账本的全部价值正是让这件事同步可查。
- **替代：账本挂在 `SessionActor` 上**——否决。账本模型含 `ExternalCaller` 与外部事务，把它放进传输无关的 session 核心会越过 ADR-0020 的边界。

**实现补充（2.3 落地时确定）：账本在三个模块的构造参数上都是可选的，但共享性由构造成立。**

`ledger` 在两个执行器与 pipeline 的 options 上都是可选参数，缺省时各自新建一份；两个执行器各暴露一个 `get transactionLedger()`；pipeline 缺省取 `options.executor.transactionLedger`，并在注入 `interactiveExecutor` 时校验它与自己的账本是同一实例，否则在构造时抛错。

理由是取舍：

- 「必填注入」会让共享性由类型强制，但牵动 **77 个构造站点**（40 个 `CommandExecutor`、5 个 `InteractiveCommandExecutor`、32 个 `ExternalToolPipeline`），其中绝大多数是只使用单个执行器的测试，它们并不关心账本。
- 「各自缺省、pipeline 采纳 `CommandExecutor` 的实例」让生产路径天然共享一份，而单独使用执行器的场景各有一份也语义正确。
- 注入的 `interactiveExecutor` 若自带另一份账本，pipeline 的门禁就会看不见它的事务——这种失败是**静默**的，所以构造时必须校验实例同一性并抛错。宁可构造失败，也不要一个看不见事务的门禁。

### 5. 输入请求账本：一个 Module，两层各持一份实例

```ts
export class InputRequestLedger {
  locate(caller: ExternalCaller | undefined, requestId: string): InputRequestRecord | undefined;
  register(caller: ExternalCaller | undefined, requestId: string, record: InputRequestRecord): void;
  clear(): void;
}

export function matchesInputRequestFingerprint(
  record: InputRequestRecord,
  wanted: InputRequestFingerprint,
): boolean;
```

- 键为 `caller.kind \0 caller.id \0 requestId`；`sessionId` 由 per-Session 实例隐含，因此复合键与 `specs/mcp-access/spec.md` 第 244 条的主键 `(caller identity, sessionId, inputRequestId)` 一致，同时消除两处键空间的分叉。键的拼法与指纹比较都留在账本内部，不泄漏到调用方。
- **实例按层持有，不共享**：pipeline 持一份用于工具响应，`InteractiveCommandExecutor` 持一份用于事务内输入。
- **实现时推翻的规划**：原计划让两层共享同一实例。核实后不成立——两层刻意缓存**不同的 replay 负载**：执行器的重放记录必须剥掉输出（`createInputReplaySummary` 的注释写明「去重记录不得保留可能含密码回显的原始 PTY 文本」），而 pipeline 的重放要返回首次调用时**已脱敏的即时输出**。共享实例会强迫两层把两份不同的负载塞进同一字段。
- 共享实例还会制造直接的自环：pipeline 在授权前登记「进行中」记录，执行器 `locate` 会命中这份记录并直接返回它的 promise，而该 promise 只在 `#performInput` 返回后收敛——`#performInput` 正在等执行器。
- 因此这次的收敛是**模块层面的**：一份实现、一条键规则、一处指纹比较，取代原先「pipeline 自建 Map ＋ 执行器自建 Map」两套各自实现的去重。跨模式拒绝仍然成立：pipeline 的账本对所有它经手的 requestId 都有记录，模式不一致时在到达执行器之前就被拒。
- 与之对照，活动事务账本仍然是**单一共享实例**：它的条目只持有身份与一个 `status()` 回调，不承载任何分层负载，所以「单一权威」在那里既能达成也应该达成。
- **替代：共享一份实例并给记录加「写入是否已派发」标记**——否决，两层仍需要两只不同的 replay 字段，等于把两份账本重新编码进一条记录。

### 6. 执行器的输入请求携带完整调用方身份

`InteractiveInputRequest.callerId: string` 改为 `caller: ExternalCaller`。

- executor 已经用 `callerId` 做身份相等判断，把身份从一个字符串碎片升为领域类型让「调用方身份」只是一个概念，也让账本能从它派生键。
- **替代：由 pipeline 传入拼好的 `callerKey`**——否决，那会把键格式这个协议细节推给上层。**替代：executor 内假定 `kind === 'mcp'`**——否决，会把调用方类型写死在 session runtime 里。

### 7. 输入上限常量收进 `domain` 并成为唯一来源

新增一份外部输入上限常量，`ExternalToolPipeline` 的 `inputGrantLimits(mode)` 与 `InteractiveCommandExecutor` 的实际执行上限都从它派生。

- 这不止是整洁问题：审批卡片展示的「固定调用上限 / 固定字节上限 / 连续空闲上限」正是用户据以批准的依据，两份常量一旦漂移，卡片就在对用户说假话。今天两者数值一致，但其中 `one_shot` 的字节上限与单次 payload 上限相等属于巧合式对齐，没有机制保证。
- **替代：保留两份并加一致性测试**——否决，测试只能发现漂移，不能阻止漂移。**替代：让 pipeline 从 executor 读上限**——否决，会让审批层依赖执行器的具体实现。

### 8. 对外的 `SESSION_BUSY` 判定收成一处，执行器保留局部不变量

- 对外表达 `SESSION_BUSY` 的判定收成一处：pipeline 改为「一次账本查询 ＋ 一次租约查询」，不再自行 OR 三处状态。
- `CommandExecutor.execute` 与 `InteractiveCommandExecutor.#start` 的 `#active` 检查**保留**，但降级为「本 Module 的内部不变量」——它们保护的是「两个 run 不能同时在同一个执行器里」，而不是重复表达跨 Module 的事务唯一性。`CommandExecutor` 是 `terminal-service` 的公开 Interface（`src/index.ts` 目前 `export *`），直接调用者可能绕过 pipeline 的门，因此这个局部不变量不能删。
- pipeline `interrupt` 的跨事务拒绝改读账本，不再单独探测 interactive executor 的 `activeTransactionId`。
- 因此本决策的目标不是「5 处减到 1 处」这种计数，而是**权威只在一处**：跨 Module 的事务唯一性由账本回答，执行器只守自己的门。

### 9. 严格行为不变，不产生规格变更

本变更以 `.openspec.yaml` 的 `skip_specs: true` 声明无规格变更。发现的行为疑点（`#hasExternalActivity()` 把审批占位算作活动）不改，记录在 `proposal.md` 的范围外项里。

### 10. 两刀交付

- **第一刀**：删除只写不读的 `ActiveRun.inputRecords`；把输入上限常量收进 `domain`，审批卡片展示与执行上限改为派生。两部分各自独立、低风险。
- **第二刀**：引入两个账本 Module，两个执行器接入，pipeline 切换读取，`callerId` 升为 `ExternalCaller`。
- 理由：上一轮的经验是「不能在实现中途才想拆」。不采用「双写过渡」方案——那会在过程中短暂造出第三份账本，与本变更的目的相冲。
- **实现补充：两刀按实现增量交付，但落在同一个提交里。** 原判断「两部分触碰的代码基本不相交」不成立：`external-tool-pipeline.ts`、`interactive-command-executor.ts` 与 `external-tool-pipeline.interactive.test.ts` 三个文件同时承载两刀的改动。两刀各自都在当时独立验证过（第一刀结束时全量 `70 passed / 1 skipped`、`409 passed / 2 skipped`；第二刀结束时 `72 / 1 skipped`、`426 / 2 skipped`），所以中间状态是有效的；但要把它们拆成两个提交，只能手工重建那个中间状态，而三个文件的混合 hunk 会让重建过程中的每个中间提交都有「编译不过」的风险，收益仅是历史叙事。因此改为一个提交，并在提交信息里把两刀分开写清。

## Risks / Trade-offs

- [统一键空间可能改变事务内输入的幂等语义] → 账本 per-session，键与 spec 244 主键一致；用既有断言固定「同一 requestId 不能跨输入模式或 grant 命中」，并在第二刀对照这些用例逐个确认。
- [`status()` 回调可能被在事务终结后调用] → 注销点设为事务终态，条目消失后不再提供 `status()`；终态查询仍走执行器历史（Decision 2）。
- [门禁收敛会削弱防御] → 执行器保留局部不变量检查（Decision 8），只是不再是跨 Module 权威。
- [上限同源后，将来若两类上限需要不同语义会受限] → 今天它们表达同一件事；将来若确实要区分，应引入两套语义而不是两套数字。
- [第一刀触碰输入常量可能影响输入校验与错误码] → 第一刀只搬常量、不改数值与检查顺序，用既有输入校验测试与新增的一致性断言固定。
- [与 `add-terminal-file-transfer-and-status` 的「有序操作槽」在同一条链路上] → 本变更不触碰 `SessionActor`，只在执行器调用侧相邻；该 change 落地后复核一次账本与操作槽的边界。

## Migration Plan

- 无数据迁移、无持久化状态、无 IPC 契约变更。两刀各自可独立回滚。
- 安全停止条件：第二刀完成后逐项核对对外行为——稳定错误码、`SESSION_BUSY` 的出现位置与文本、审批卡片展示的上限数值、幂等重放的返回结果。任一项变化即停止并修正，不继续。
- 文档闭环：`CONTEXT.md` 不新增词条（账本是实现词汇）；本变更不新增 ADR（行为不变的结构收敛，被否掉的替代方案已记在本文件）。
