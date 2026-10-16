# Tasks

## 1. 词表与英文渲染（新模块，先判红）

- [x] 1.1 先写 `packages/mcp-runtime/src/mcp/risk-reasons.test.ts` 并确认判红：遍历 `RISK_REASON_CODES` 断言每个 code 都能渲染，且对今天引擎与 pipeline 产生的**全部 15 条字面量**逐字相同（带 `subject` 的用真实名字，如 `rm`）
- [x] 1.2 实现 `risk-reasons.ts`：`RISK_REASON_CODES` 运行时数组、派生的 `RiskReasonCode`、判别联合 `RiskReason`（需要 `subject` 的 code 在类型上强制携带）与 `renderRiskReasonEn`；`pnpm typecheck` 与 `pnpm test risk-reasons` 通过

## 2. 引擎与管线改为 code

- [x] 2.1 `policy-engine.ts` 的 15 处字面量改为 `RiskReason`（`:173` 与 `:209` 共用 `state-changing-command`），删除只写不读的 `commandHash`（声明、计算与 `decision()` 形参）；`pnpm test policy-engine` 通过
- [x] 2.2 `policy-engine.test.ts:12/123/152/161` 的断言从英文串改为 code；`pnpm test policy-engine` 通过
- [x] 2.3 `external-tool-pipeline.ts`：`ApprovalRequest.reasons`（`:54`）与三处组装（`:935/953/971`）改传 code，自由输入那条硬编码改为 `free-input-writes-to-pty`；`riskEvidence.reasons`（`:428/533`）在边界用 `renderRiskReasonEn` 渲染成 `string[]`；`pnpm test external-tool-pipeline` 通过
- [x] 2.4 `approval-queue.ts` 的 `ApprovalRequest.reasons`（`:13`）与 `current`（`:66`）跟随；`external-tool-pipeline.test.ts:214`、`approval-queue.test.ts:9` 的夹具改 code；`pnpm test` 通过
- [x] 2.5 对外不变性对照：逐条断言 MCP 工具响应里的 `reasons` 与改动前**逐字相同**（15 条全部对照），把对照结论写进本文件

## 3. 展示层

- [x] 3.1 在 `apps/desktop/src/renderer/i18n/zh-cn.ts` 新增 code → 中文映射（`satisfies` 穷尽约束）；今天已显示正确中文的两条（含 PowerShell 变体）保持逐字相同
- [x] 3.2 `approval-card.tsx` 删除三条正则、`Map`、死条目与兜底分支，改为查表；`approval-card.test.tsx` 补断言：每个 code 都有中文，并专门断言此前漏英文的 `sort-output-file` 显示中文；`pnpm test approval-card` 通过
- [x] 3.3 `renderer/mock-api.ts` 的夹具改为 code；`pnpm test` 与 `pnpm test:e2e` 通过

### 实现记录（第 1 至 3 组）

**2.5 对外不变性的对照结论。** 三条证据链合起来覆盖「对外 payload 逐字不变」：

1. `risk-reasons.test.ts` 对今天引擎与 pipeline 产生的**全部 15 条字面量**逐条断言渲染结果（含 `has destructive semantics` 与 `has destructive system semantics` 的措辞差异、`rm` 那条被正则吞掉的 `irreversible`）。
2. `policy-engine.test.ts` 现在断言的是**精确的 code 数组**（比原来的 `join(' ').toMatch(/…/)` 更严）：`ls -la /tmp` → `[read-only-rules-matched]`；`npm test` → `[state-changing-command/npm]`；`./deploy.sh | tee deploy.log` → `[unknown-executable/./deploy.sh, unknown-executable/tee]`；`npm test && curl example.com` → `[state-changing-command/npm, unknown-executable/curl]`。这些断言一次通过，说明引擎的输出集合未变。
3. **`external-tool-pipeline.test.ts:214` 的断言逐字未改而通过**——它断言的是 MCP 工具响应 `result.reasons` 里的 `'all commands match read-only rules'`。若渲染没有发生在证据边界，该断言的类型与值都会失败。这是「对外仍是英文散文、内容逐字相同」的直接证据。

**两处实现细化（与 design 的差异，均已落地）：**

1. **中文表拆成两张而不是一张。** design Decision 5 写的是「一张表用 `satisfies` 约束穷尽」。用单表时，不接收参数与接收 `subject` 的条目签名不一致，`Record<RiskReasonCode, (subject: string) => string>` 会让无参条目带上一个假参数，而 `satisfies Record<…, (subject: string) => string | (() => string)>` 这种写法语义混淆。最终按 `risk-reasons.ts` 的同构做法拆成 `subjectlessRiskReasonText`（9 条，`Record<SubjectlessRiskReasonCode, string>`）与 `subjectRiskReasonText`（6 条，`Record<SubjectRiskReasonCode, (subject: string) => string>`），两张表各自精确穷尽，无假参数。
2. **`mcp-runtime` 的公共出口是显式具名导出**（不是 `export *`），因此补了 `risk-reasons.js` 的两个值（`RISK_REASON_CODES`、`renderRiskReasonEn`）与六个类型；`apps/desktop/src/shared/contracts.ts` 再导出 renderer 需要的 `RiskReason`、`RiskReasonCode`、`SubjectlessRiskReasonCode`、`SubjectRiskReasonCode`。

**夹具的顺带修正：** `approval-queue.test.ts` 与 `approval-card.test.tsx` 原先都用 `reasons: ['irreversible']`——那正是 `formatReason` 里从未被引擎产出过的**死词汇**。现在换成引擎真会产生的内容（`irreversible-destructive-command/rm` 等）；`mock-api.ts` 的 `['unknown executable']`（缺冒号与名字）也改为按命令首词派生 `{ code: 'unknown-executable', subject }`，不再与真实格式漂移。

**验证：** `pnpm typecheck` 六个包全通过；`pnpm test` **73 文件 / 429 项通过**（改动前 72 / 426，差额为新增的 2 项词表测试与 1 项卡片用例）；`SYNAPSE_TERM_ELECTRON_E2E=1 pnpm test:e2e` **26/26 通过**；`pnpm exec eslint` 干净。

**过程中的一次环境操作：** E2E 再次被环境的批量删除护栏拦下（Playwright 启动时要清理上一轮留下的 920 个 `test-results` 文件）。已确认该目录被 `.gitignore:14` 忽略、全是生成物，清一次后重跑通过。

## 4. 记录与文档

- [x] 4.1 复核 `CONTEXT.md` 与 ADR：确认本次无需新增词条也无需新增 ADR，把依据写进本文件
- [x] 4.2 检查 `docs/architecture/architecture.md`、`docs/reference/mcp-tools.md` 与 `docs/development/testing.md` 是否需要同步（需要则改，不需要则把依据写进本文件）

### 第 4 组记录

**4.1 `CONTEXT.md` 与 ADR：都不需要动。**

- `CONTEXT.md` 已有「风险分类（Risk Class）」（`:119-121`），其定义里已写明「分类应同时说明置信度、判定原因与是否需要审批」——**判定原因这个领域概念已存在**，本次改的是它在实现里的编码方式（散文 → code），不是领域语义。把 `RiskReasonCode` 的 15 个取值写进词汇表会把词汇表变成实现词典，与前两个 change 对「外部写入前提」「账本」的处理一致。
- 不新增 ADR：本次不改变对外契约（工具响应逐字不变）、不改判定逻辑、易于回退（两张表与 15 处产出点都是本地的），不满足 `docs/development/conventions.md` 对新增 ADR 的门槛。唯一值得记录的取舍（英文逐字保留、不顺手统一措辞）写在 design 的 Decision 4 与本文件里。

**4.2 三份文档：都不需要同步。**

- `docs/reference/mcp-tools.md`：对 `风险理由|confidence|requiresConfirmation|riskEvidence` 的检索是**零匹配**——Reference 不记录这些字段，因此 `reasons` 的形态变化没有它要同步的内容。
- `docs/architecture/architecture.md`：`:63` 只列出 `mcp:approval` 这个**通道名**，`:67` 明确「具体 channel 名称属于 Desktop 实现契约」；本次改的是该通道的 payload 形态，文档层面无对应描述需要改。包职责表也不涉及风险分类的产出位置（仍在 `mcp-runtime`）。
- `docs/development/testing.md`：矩阵是范围级的，`:25` 的 desktop 行覆盖「Composition Root、IPC adapter/preload、白名单、设置、主题和 Mock API」，`:36` 的 E2E 行已明确列出「审批卡片」；本次新增的测试落在这些既有范围内，不需要把模块名写进矩阵。

## 5. 整体验证

- [x] 5.1 运行 `openspec validate structure-risk-reasons --strict` 与 `git diff --check`，两者均通过
- [x] 5.2 运行 `pnpm verify`（format:check、docs:check、lint、typecheck、test）并通过
- [x] 5.3 运行带 `SYNAPSE_TERM_ELECTRON_E2E=1` 的 `pnpm test:e2e` 确认审批与外部执行行为未变；如实记录本次实际执行的验证范围与未运行项（含本机缺 MSVC 导致的打包配置缺口）

## 整体验证记录

| 检查 | 结果 |
| --- | --- |
| `openspec validate structure-risk-reasons --strict` | valid（附 INFO：`skip_specs` 已声明，zero deltas accepted） |
| `git diff --check` | 干净 |
| `pnpm verify` | format:check ✓、docs:check ✓（58 个文件无断链）、lint ✓、typecheck ✓、**73 文件 / 429 项通过**，1 文件 2 项跳过 |
| `pnpm build`（main / preload / renderer） | 三步退出码均为 0 |
| `SYNAPSE_TERM_ELECTRON_E2E=1 pnpm test:e2e` | **26/26 通过**（1.5 分钟），含真实 `_electron.launch` 的 `electron-mcp-access.spec.ts` |

与改动前基线对照：通过数从 426 增至 429，差额全部是新增用例（`risk-reasons.test.ts` 的 2 项与 `approval-card.test.tsx` 的 1 项）；新增 1 个测试文件。**除 `policy-engine.test.ts` 的 4 处断言按计划从英文串改为 code 之外，没有任何既有断言需要改期望值**——其中 `external-tool-pipeline.test.ts:214` 断言对外工具响应的英文理由，它逐字未改而通过，是「对外 payload 不变」的直接证据。

**未运行项：** 打包冒烟与平台验证。本次只改 TypeScript（领域/服务端产出、IPC payload 形态与 renderer 展示），未触碰打包配置、`electron-builder.yml`、安装器或平台更新链；且本机缺 MSVC，`npmRebuild: true` 的正式打包路径与前两个 change 一样无法验证。`pnpm test:installer` 与 macOS 打包同样未运行。

**过程中的一次环境操作：** E2E 被环境的批量删除护栏拦下（Playwright 启动时要清理上一轮留下的 920 个 `test-results` 文件）。已确认该目录被 `.gitignore:14` 忽略、未被 git 跟踪、内容全是 Playwright 产物，清一次后重跑通过。
