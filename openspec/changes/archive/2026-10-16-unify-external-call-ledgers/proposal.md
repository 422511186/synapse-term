# Proposal

## Why

外部事务与外部输入的状态被分散在多个 Module，同一事实有多处权威与副本：

- 「本 Session 有活动外部事务」由 `CommandExecutor.#active`、`InteractiveCommandExecutor.#active`（两个权威）与 `ExternalLeaseRegistry`（caller 粒度的第二权威）分别表示，`ExternalToolPipeline` 每次读取时把三者 OR 起来推导。结果是「一个 Session 同时只允许一个外部事务」这条规则在 5 处被重复表达，并混用了两种粒度（caller 租约 vs per-executor 活动事务）。
- 输入幂等（`inputRequestId` 去重）在 pipeline 与 `InteractiveCommandExecutor` 各实现一遍，而两处键空间不同（pipeline 键含 `caller.kind` 与 `sessionId`，executor 键只有 `callerId` 与 `requestId`）；另有 `ActiveRun.inputRecords` 是只写不读的死副本。`specs/mcp-access/spec.md` 第 244 条要求的检查顺序因此被实现两遍。
- 输入授权上限在 pipeline（审批卡片展示）与 `InteractiveCommandExecutor`（真正执行）各有一份常量。今天数值一致，但没有机制保证一致；而卡片展示的「固定调用上限 / 固定字节上限 / 连续空闲上限」正是用户据以批准的依据。

代价落在理解与验证上：一次「事务 + 输入」横跨 pipeline、interactive executor 与租约注册表三处，三个测试文件各自复制一套 harness 才能覆盖它。

## What Changes

- 不改变任何外部可观察行为：本次是纯结构收敛，稳定错误码、工具响应字段、审批行为、错误文本与全部时间语义保持不变。
- `terminal-service` 新增两个**独立** Module：活动事务账本（per-session，持有活动事务的身份与存在性，并借一个 `status()` 读取回调；事务状态的唯一权威仍留在执行器）与输入请求账本（per-session，覆盖事务内与自由两种模式）。
- 两个执行器在启动与终态时向活动事务账本登记与注销；`ExternalToolPipeline` 不再自行合成三处状态，改为向账本查询。
- 输入请求账本由 pipeline（自由模式）与 `InteractiveCommandExecutor`（事务内模式）共同使用；两种输入处理**不**合并。统一后的键为 `(caller identity, inputRequestId)`，sessionId 由 per-session 实例隐含，与 `specs/mcp-access/spec.md` 第 244 条的主键一致。
- `InteractiveInputRequest` 的 `callerId: string` 升为 `caller: ExternalCaller`，键由账本派生，键格式不泄漏到上层。
- `domain` 定一份外部输入上限常量，审批卡片展示与执行器实际执行的上限都从它派生。
- 删除只写不读的 `ActiveRun.inputRecords`。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无：本变更不改变外部可观察行为，按 schema 约定以本 change 的 `.openspec.yaml` 声明 `skip_specs: true`，不产生 delta spec。）

## Impact

- `packages/terminal-service`：新增活动事务账本与输入请求账本两个 Module；`CommandExecutor` 与 `InteractiveCommandExecutor` 在启动/终态接入账本；`InteractiveInputRequest` 的 `callerId: string` 改为 `caller: ExternalCaller`；删除 `ActiveRun.inputRecords`。该包 `src/index.ts` 目前是 `export *`，导出面需同步（新增 Module 是否进公共出口由 design 决定）。
- `packages/mcp-runtime`：`ExternalToolPipeline` 删除自建的活动事务推导与输入去重账本，改为使用下层账本；`#hasExternalActivity` 的三源 OR 收成一次账本查询；审批卡片展示的上限改由 `domain` 常量派生。
- `packages/domain`：新增外部输入上限常量；不新增领域概念。
- 外部 Interface：八个 `synapse_*` 工具的错误码、响应字段与时间语义均不变，因此不需要同步 `docs/reference/mcp-tools.md` 的契约内容。
- 文档与决策记录：`CONTEXT.md` 不新增词条——账本属于实现词汇，本次也没有新增或改变稳定领域概念。本次不新增 ADR：它是行为不变的结构收敛，被否掉的替代方案记在 design.md。若实现中发现必须接受的行为变化，先按 `AGENTS.md` 说明冲突再决定是否补规格。
- 与进行中的事实源的关系：`add-terminal-file-transfer-and-status` 计划在 `SessionActor` 内引入「有序操作槽」；本变更**不触碰** `SessionActor`，只在执行器的调用侧相邻，因此不与之冲突。该 change 落地后需复核一次账本与操作槽的边界。
- 明确的范围外项（各自记录为后续候选，不在本变更内）：pipeline 的会话内放行 `#sessionGrants`（审批策略，按 ADR-0020 属 `mcp-runtime`）；三个测试文件缺失的共享 harness；`#hasExternalActivity` 把「审批中但尚未成为事务」的调用也算作活动事务这一行为疑点（可能是有意占位，也可能是实现副产品，需要单独评估）。
- 验证范围：`pnpm verify`、`openspec validate unify-external-call-ledgers --strict`、`git diff --check`。本变更不改 UI、IPC 契约与打包配置，不新增 E2E 或平台冒烟。
