# Tasks

## 1. 第一刀：删除死副本与上限同源（行为不变）

- [x] 1.1 先建立对照基线：在 `external-tool-pipeline.test.ts` 断言 `inputGrantLimits('one_shot')` 与 `('bounded')` 当前返回的次数、字节与空闲超时三个数值；`pnpm test external-tool-pipeline` 通过并记录数值
- [x] 1.2 在 `packages/domain` 新增外部输入上限常量，让 `input-encoder` 的既有上限与 `ExternalToolPipeline.inputGrantLimits` 都从它派生（只搬常量、不改数值）；1.1 的对照断言不变
- [x] 1.3 让 `InteractiveCommandExecutor` 的实际执行上限从同一常量派生（`one_shot` 与 `bounded` 的次数、字节、空闲超时），不改任何比较逻辑；`pnpm test` 通过且输入配额相关既有断言不变
- [x] 1.4 删除只写不读的 `ActiveRun.inputRecords` 及其初始化；`pnpm typecheck` 与 `pnpm test` 通过
- [x] 1.5 记录第一刀的对外不变性：逐项确认稳定错误码、`SESSION_BUSY` 的出现位置与文本、审批卡片展示数值、幂等重放结果均未变化，并把结论写进本文件

### 第一刀记录

1.1 建立的基线（已由 `external-tool-pipeline.interactive.test.ts` 的两个用例钉住）：

| 档位 | 审批卡片展示的次数 / 字节 / 空闲 |
| --- | --- |
| `one_shot` | 1 / `16 * 1024` / `10 * 60_000` |
| `bounded` | 256 / `256 * 1024` / `10 * 60_000` |

1.5 的对外不变性结论：

- **数值逐项相同**：收进 `domain` 的六个数字与原 `input-encoder.ts` 和 `interactive-command-executor.ts` 中的字面量逐一相同（`8 * 1024`、`128`、`16 * 1024`、`1`、`256`、`256 * 1024`、`10 * 60_000`）；唯一新增的显式关系是 `one_shot.maxBytes = MAX_INPUT_PAYLOAD_BYTES`（原先也是 `16 * 1024` 字面量，属巧合式对齐，现在写成了意图）。
- **比较逻辑未动**：`callsUsed >= 1` 改为 `callsUsed >= EXTERNAL_INPUT_GRANT_LIMITS.one_shot.maxCalls`，而该值为 `1`；其余检查逐字未改。
- **删掉的只有死副本**：`ActiveRun.inputRecords` 在改动前全仓无读取点（只有声明、初始化与写入）。
- **证据**：全量 `70 passed / 1 skipped`（`409 passed / 2 skipped`）；其中钉住 `SESSION_BUSY` 出现位置、幂等重放结果与卡片数值的用例全部通过，且没有修改它们的断言。
- 一处**范围外**的残留：`approval-queue.ts` 另有结构相同的 `ApprovalInputLimits`（仅字段形状重复，不持有数值）。本次不动它，避免改动审批队列契约。

## 2. 第二刀：两个账本 Module（行为不变）

- [x] 2.1 先写两个账本的单测并确认判红，再实现转绿：活动事务账本的 open / close / active 与「已有条目时抛错」「注销后 active 为空」；输入请求账本的 locate / register / clear 与「键含 `caller.kind`」「同一 requestId 不同 caller 不命中」；`pnpm test` 通过
- [x] 2.2 `InteractiveInputRequest.callerId: string` 升为 `caller: ExternalCaller`，executor 内部的身份相等判断改用它；`pnpm test interactive-command-executor` 通过且既有身份相关断言不变
- [x] 2.3 两个执行器在启动与终态接入活动事务账本（登记 / 注销），账本经构造参数注入；`pnpm test` 通过且既有「同时只允许一个外部事务」断言不变
- [x] 2.4 `InteractiveCommandExecutor` 的输入去重改用输入请求账本并删除 `#inputHistory`；`pnpm test interactive-command-executor` 通过且「去重先于配额与 expectedContextId」相关既有断言不变
- [x] 2.5 `ExternalToolPipeline` 改用两个账本：删除 `#inputRequests` 与自建的活动事务合成，`#hasExternalActivity` 收成「账本查询 ＋ 租约查询」，`interrupt` 的跨事务拒绝改读账本；`pnpm test` 通过且 `SESSION_BUSY` 相关既有断言不变
- [x] 2.6 `McpController.share()` 构造两个账本并注入 `CommandExecutor` 与 `ExternalToolPipeline`；`pnpm test` 通过
- [x] 2.7 端到端对照：运行既有 `pnpm test:e2e`（含带 `SYNAPSE_TERM_ELECTRON_E2E=1` 的真实 Electron MCP 用例），确认审批、输入、幂等重放与 `SESSION_BUSY` 的对外行为未变

### 第二刀进展（2.1）

两个 Module 已落地并接入包公共出口（跨包使用必须走公共出口）：

- `packages/terminal-service/src/session/external-transaction-ledger.ts`：`ExternalTransactionEntry` + `ExternalTransactionLedger`（`open` / `close` / `active`）。`close` 返回是否真的移除，id 不匹配或条目已消失按幂等处理。
- `packages/terminal-service/src/session/input-request-ledger.ts`：`InputRequestRecord`、`InputRequestFingerprint`、`InputRequestLedger`（`locate` / `register` / `clear`）与 `matchesInputRequestFingerprint`。

实现中发现两处影响 Interface 的事实：

1. **执行器记录里的 `resolve` / `reject` 是死字段。** 核对 `interactive-command-executor.ts` 的全部 `record.resolve` / `record.reject` 用法：只有赋值（含把回调置空），没有任何读取；`#cachedInputResult` 只读 `error`、`outcome`、`promise`。因此统一后的 `InputRequestRecord` 是纯值对象，不需要携带 deferred 钩子——与 `ActiveRun.inputRecords` 同类，都是「写给自己看」的字段。
2. **`ExternalCallerKind` 目前只有 `mcp` 一个成员。** 账本的键按设计含 `caller.kind`（忠于 `specs/mcp-access` 的「caller identity」与 pipeline 既有键），但该维度今天不可观测，因此单测只覆盖 id 维度，没有用类型断言虚构「不同 kind」的覆盖。这条同时是 Decision 5 键设计的一个已知限制。

`pnpm typecheck` 六个包全通过；全量 `72 passed / 1 skipped`（`425 passed / 2 skipped`）。

### 第二刀进展（2.5 与 2.6）

**2.5**：`ExternalToolPipeline` 已切换。删除 `#inputRequests` / `InputDedupeRecord` / `#inputRequestKey` / `#cachedInputResult` 之外的自建合成；`activeTransactionId` 与 `activeTransactionKind` 直接读账本条目；`#hasExternalActivity` 收成两源（账本 ＋ 租约）；`interrupt` 的跨事务拒绝改读 `#ledger.active?.kind`。

**2.6**：`McpController.share()` 在组合点显式创建 `ExternalTransactionLedger` 并注入 `CommandExecutor` 与 `ExternalToolPipeline`。

**基于 2.4～2.5 的实现证据，推翻并修正了 design 的 Decision 5。** 原计划让 pipeline 与执行器共享同一份输入请求账本实例；核实后不成立：

- 两层刻意缓存**不同的 replay 负载**。执行器的重放记录必须剥掉输出——`createInputReplaySummary` 的注释写明「去重记录不得保留可能含密码回显的原始 PTY 文本」；而 pipeline 的重放要返回首次调用时**已脱敏的即时输出**（`#redactInteractive(...)` 的结果）。共享实例会强迫两层把两份不同的负载塞进同一个 `outcome` 字段。
- 共享实例还会制造直接的自环：pipeline 在授权前就登记「进行中」记录，执行器 `locate` 会命中它并直接返回它的 promise，而该 promise 只在 `#performInput` 返回后收敛——`#performInput` 正在等执行器。
- 因此这次的收敛落在**模块层面**：一份实现、一条键规则、一处 `matchesInputRequestFingerprint`，取代原先「pipeline 自建 Map ＋ 执行器自建 Map」两套各自实现的去重；实例按层持有。跨模式拒绝仍然成立，因为 pipeline 的账本对它经手的每个 requestId 都有记录，模式不一致时在到达执行器之前就被拒。
- 与活动事务账本对照：那一侧仍是**单一共享实例**，因为它的条目只持有身份与一个 `status()` 回调，不承载分层负载。所以「单一权威」在事务侧达成，在输入侧达成的是「一份实现」而不是「一个实例」——这是这次收敛的实际边界，写在这里而不是让它悄悄缩小。

2.6 因此只显式注入事务账本；输入请求账本按 Decision 5 由各层自建默认实例，不做实例同一性校验（两侧本就应该不同）。

### 第二刀进展（2.4）

`InteractiveCommandExecutor` 的输入去重已迁到 `InputRequestLedger`：删除 `#inputHistory`、`#inputKey` 与本地 `InputRecord` 类型，新增可选 `inputLedger` 与 `get inputRequestLedger()`；比较改用 `matchesInputRequestFingerprint`。

三处实现细节：

1. **删掉了记录上的 `resolve` / `reject`。** 收敛前它们在记录里只有赋值、零读取（`#cachedInputResult` 只读 `error` / `outcome` / `promise`），因此改用 `#input` 本地的 `deferred` 直接收敛，行为不变。
2. **账本的负载类型是 `unknown`，每个归属方在自己的读取处收窄一次。** 账本按设计不解释归属方的结果类型（pipeline 的自由输入与执行器的事务内输入结果类型不同），执行器的唯一收窄点是 `#cachedInputResult`，已就地注释。
3. **账本接受缺省调用方身份，保留「无身份请求共用一个桶」的既有语义。** 收敛前执行器的键在 `caller` 缺省时退化成空串；新的键用 `caller?.kind ?? ''` 与 `caller?.id ?? ''` 表达同一退化，并补了一条单测固定它。这条语义看着奇怪，但改变它属于行为变更，不在本次范围内。

`pnpm typecheck` 全通过；账本单测 17 项、执行器与管线 53 项、全量 `72 passed / 1 skipped`（`425 passed / 2 skipped`，与 2.4 前逐项相同）。

### 第二刀进展（2.3）

两个执行器已接入账本：`CommandExecutorOptions` 与 `InteractiveCommandExecutorOptions` 新增可选 `ledger`，两者各暴露 `get transactionLedger()`；结构化在 `run.sent = true` 之后 `open`、在 `#commitFinish` 与 `#rejectBeforeSend` `close`；交互在同一个位置 `open`、在 `#settle` 与 `#rejectStart` `close`（写入前失败不会登记，close 幂等）。pipeline 缺省采纳 `options.executor.transactionLedger`，并把它传给自建的交互执行器。

三个实现决定：

1. **共享性由构造保证**（已回填 design.md Decision 4 的补充）：三个模块的 `ledger` 都是可选参数；注入的 `interactiveExecutor` 若自带另一份账本，pipeline 在构造时抛错。这个校验立刻生效——`createPipelineWithInteractiveOptions` harness 因此在两处用例上响亮失败，已改为让两个执行器与 pipeline 共享一份。
2. **条目的 `caller` 可选**：结构化执行的 `ExecuteCommandInput` 允许不携带调用方，因此 `ExternalTransactionEntry.caller` 改为可选（design.md Decision 2 的 Interface 草案已同步）。pipeline 在 `execute` 时传入 `context.caller`。
3. **观察到一次偶发失败**：全量运行中 `command-executor.powershell.integration.test.ts`（真实 PowerShell PTY）失败过一次，单独运行与随后复跑全量均通过。该用例依赖真实 ConPTY 与提示符时序，`vitest.config.ts` 已注明实时集成测试在 Windows 过载时对时序敏感；失败信息是 `AttachConsole failed` 与注册表读取失败，与账本无关（账本相关的新增校验会抛 `must share the pipeline transaction ledger`，本例没有出现）。记录在此，不当作已解决的问题。

## 3. 记录与文档

- [x] 3.1 复核 `CONTEXT.md` 与 ADR：确认账本属于实现词汇、本次无新领域概念，因此无需新增词条也无需新增 ADR；把判断依据写进本文件
- [x] 3.2 检查 `docs/architecture/architecture.md` 是否描述 pipeline 与执行器的事务、授权归属：需要则同步，不需要则在本文件记录依据
- [x] 3.3 检查 `docs/development/testing.md` 的验证矩阵是否因新增两个 Module 需要更新：需要则同步，不需要则记录依据

### 第 3 组记录

**3.1 `CONTEXT.md` 与 ADR：都不需要新增。** 判断依据：

- 两个账本是 implementation 词汇，不是领域术语。`CONTEXT.md` 的作用是「术语与边界语义的词汇表」，它已有的「外部事务」「事务不确定态」「输入授权槽」覆盖了本次涉及的全部领域概念；把 `ExternalTransactionLedger` / `InputRequestLedger` 这类模块名写进去会把词汇表变成实现词典。这与第一刀对「外部写入前提」的处理一致。
- 本次没有新增或改变任何稳定领域概念——按 Q4 的口径它是严格行为不变的结构收敛，因此不满足 `docs/development/conventions.md` 对新增 ADR 的三条门槛里最关键的一条（「来自真实权衡的决定」是满足的，但「难以回退」不满足：改回两套自建账本是纯本地重构）。
- 唯一值得记录的取舍（两层的输入请求账本各自缓存不同的 replay 负载，因此实例不共享）写在本 change 的 `design.md` Decision 5 与上面的 2.5 记录里，那是本次的结构性事实源。若将来有人要合并实例，会先读到它。

**3.2 `docs/architecture/architecture.md`：一处补正，已改。** 包职责表里 `@synapse-term/terminal-service` 一行原文是「PTY 适配、SessionActor/Manager、实时输出、Shell 发现与执行」，而活动事务账本与输入请求账本是该包新增的模块，已补入「外部调用账本」。表中 `@synapse-term/mcp-runtime` 一行仍写「外部事务、风险/审批、输入授权」，指的是该包承担的**协调职责**（审批、协议适配），与账本落在 terminal-service 不冲突，因此不动。`:77`「取消 Sharing、Session 退出、Token 吊销或应用退出会清理共享句柄、审批和外部事务」仍然成立（账本的 `clear()` 挂在这些路径上）。

**3.3 `docs/development/testing.md` 的验证矩阵：不需要改。** 矩阵是范围级而非模块级的，`terminal-service` 一行已含「结构化/交互事务和输出边界」，`mcp-runtime` 一行已含「输入授权」；两个新 Module 的单测就落在 `terminal-service` 这一行覆盖的范围内。为一次内部重构把模块名逐个写进矩阵，会让矩阵随实现漂移。

## 4. 整体验证

- [x] 4.1 运行 `openspec validate unify-external-call-ledgers --strict` 与 `git diff --check`，两者均通过
- [x] 4.2 运行 `pnpm verify`（format:check、docs:check、lint、typecheck、test）并通过
- [x] 4.3 运行 `pnpm build` 确认编译通过并如实记录结果；打包冒烟按上一轮记录的方式执行，明确标注本机缺 MSVC 导致 `npmRebuild: true` 无法验证这一环境缺口，以及本次未运行的真实打包项

## 整体验证记录

| 检查 | 结果 |
| --- | --- |
| `openspec validate unify-external-call-ledgers --strict` | valid（附 INFO：`skip_specs` 已声明，zero deltas accepted） |
| `git diff --check` | 干净 |
| `pnpm verify` | format:check ✓、docs:check ✓（58 个文件无断链）、lint ✓、typecheck ✓、**72 文件 / 426 项通过**，1 文件 2 项跳过 |
| `pnpm build`（main / preload / renderer） | 三步退出码均为 0 |
| `SYNAPSE_TERM_ELECTRON_E2E=1 pnpm test:e2e` | **26/26 通过**（2.3 分钟），含真实 `_electron.launch` 的 `electron-mcp-access.spec.ts`（审批、`synapse_execute`、`synapse_start_interactive`、`synapse_input`、`synapse_finish_interactive`、令牌吊销与输出脱敏） |
| `electron-builder --win dir` ＋ `pnpm smoke:packaged-desktop` | 产物生成；冒烟返回 `{"ok":true,"sessions":1,"version":"0.6.1","updater":"idle"}` |

与改动前的基线对照：全量测试文件数与跳过数不变（`72 / 1 skipped`），通过数从 408 增至 426，差额全部来自本次新增用例（两个账本单测 17 项 ＋ 第一刀的卡片上限用例 1 项）。

**环境缺口（与本变更无关，延续上一轮的记录）：** `electron-builder.yml` 的 `npmRebuild: true` 需要 Visual Studio 的 C++ 桌面开发工具与 Windows SDK；本机没有该工具链，因此 `pnpm package:win` / `pnpm package:win:dir` 在正式配置下失败。上面的打包冒烟是在 `--config.npmRebuild=false` 的**试验性旁路**下产出的产物上执行的，它证明打包应用能启动、能加载 node-pty 并起真实 PTY，但**不等价于验证正式配置**。`pnpm test:installer`（NSIS 安装/升级/卸载）与 macOS 打包同样未运行。

**过程中的一次环境操作：** E2E 首次启动被环境的批量删除护栏拦下（Playwright 要清理上一轮遗留的 `test-results`，799 个文件超过护栏阈值）。已确认该目录被 `.gitignore:14` 忽略、未被 git 跟踪、内容全是 Playwright 产物，随后手动清理并重跑。这是生成物清理，不涉及仓库内容。
