# Proposal

## Why

风险分类理由（`PolicyDecision.reasons`）是一个**隐式枚举，用英文散文编码、并内插参数**：`packages/mcp-runtime/src/mcp/policy-engine.ts` 有 14 处散落的字符串字面量，其中 4 处内插可执行文件名，类型只是 `string[]`。唯一需要它结构化形态的消费者是审批卡片，它用三条正则把这层散文反解析回「哪个可执行文件触发了规则」：

- `apps/desktop/src/renderer/mcp/approval-card.tsx:14-33` 的 `formatReason` 用 `/^unknown (?:PowerShell )?executable: (.+)$/`、`/^(.+?) can change system state$/`、`/^(.+?) has (?:irreversible )?destructive semantics$/` 抽名字，其余靠一张 6 项 `Map`，查不到就**原样吐英文**。

反解析不完整，于是**安全相关的审批卡片上真的会出现未翻译英文**：

| 真实规则 | 卡片今天显示 |
| --- | --- |
| `scripts, aliases, or dynamic shell structure cannot be fully expanded safely`（`policy-engine.ts:147`） | 英文原文 |
| `sysctl write options can change kernel state`（`:188`） | 英文原文（正则要 `system state`，这里是 `kernel state`） |
| `sort can change filesystem state with -o/--output`（`:194`） | 英文原文 |
| `${name} has destructive system semantics`（`:205`） | 英文原文（"destructive **system** semantics" 夹了词，正则不匹配） |
| `free input writes directly to the current PTY`（`external-tool-pipeline.ts:971`） | 英文原文 |
| `Map` 里的 `'irreversible'`（`approval-card.tsx:30`） | **死条目**，引擎从不产生裸 `irreversible` |

三处佐证这不是理论风险：`apps/desktop/src/renderer/mock-api.ts:161` 的夹具写成 `['unknown executable']`（缺冒号与名字），与真实格式不一致，于是同一张卡片在 mock 与真实路径下行为不同；**没有任何测试锁定 `formatReason` 的中文输出**（断言全是英文码或区块标题「风险理由」）；`PolicyDecision.commandHash` 每次分类都算一次 SHA-256，**全仓无人读取**。

根因不是「正则写得不够全」——补全它只修今天的漏，下一条新规则照样能悄悄漏英文而无人察觉。

## What Changes

- 把理由的词汇表变成显式联合类型：新增 `packages/mcp-runtime/src/mcp/risk-reasons.ts`，用 `const RISK_REASON_CODES` 运行时数组派生 `RiskReasonCode`，并定义 `RiskReason { code, subject? }` 与 `renderRiskReasonEn`。
- `PolicyDecision.reasons` 从 `string[]` 改为 `readonly RiskReason[]`；删除只写不读的 `commandHash`。
- **对内的卡片路径**：`ApprovalRequest.reasons`（pipeline 与 `ApprovalQueue`）随之为 `RiskReason[]`，经现有 `apps/desktop/src/shared/contracts.ts` 再导出到 renderer。
- **对外的证据路径**：`riskEvidence.reasons` 仍是 `string[]`，由 `renderRiskReasonEn` 渲染；**全部英文串逐字保持不变**（含 `has destructive system semantics` 与 `has destructive semantics` 这类措辞不一致）。
- 展示层删除三条正则、那张 `Map` 与死条目，改为在 `apps/desktop/src/renderer/i18n/zh-cn.ts` 里按 code 查表；两张表都由类型穷尽约束，新增 code 不写文案即编译失败。
- 唯一的可观察差异：卡片上此前漏英文的 5 条理由变为中文（与其余理由一致）。稳定错误码、工具响应字段与其余 IPC 行为都不变。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无：对外工具响应里的 `reasons` 逐字不变，错误码不变，卡片 spec 只要求「展示风险分类理由」而未规定语言与措辞，因此不产生 delta；按 schema 约定以本 change 的 `.openspec.yaml` 声明 `skip_specs: true`。）

## Impact

- `packages/mcp-runtime`：新增 `risk-reasons.ts`；`policy-engine.ts` 的 14 处字面量与 `PolicyDecision` 形状；`external-tool-pipeline.ts` 的 `ApprovalRequest.reasons`、三处组装（`:935/953/971`）与 `riskEvidence` 的渲染点（`:428/533`）；`approval-queue.ts` 的 `ApprovalRequest.reasons` 与 `current`。
- `packages/domain`：**不改**。`CommandRiskEvidence.reasons` 保持 `string[]`（对外形态不变），因此领域类型零改动。
- `packages/terminal-service`：只搬 `riskEvidence`，类型不变。
- `apps/desktop`：`shared/contracts.ts` 跟随再导出；`renderer/mcp/approval-card.tsx` 删正则与 `Map`；`renderer/i18n/zh-cn.ts` 新增 code → 中文映射；`renderer/mock-api.ts` 夹具改为 code。
- 两层的类型归属：code 联合与英文表留在 `mcp-runtime`（renderer 已通过 `shared/contracts.ts` 从该包取审批类型，不新增依赖方向）；中文表留在 renderer——风险等级标签 `RISK_LABELS` 本来就在 `approval-card.tsx`，展示文案不进领域模型。
- 与 `docs/` 的关系：`docs/reference/mcp-tools.md` 没有记录 `reasons`/`confidence`/`requiresConfirmation` 这些字段（核实为零匹配），因此 Reference 不需要同步；`docs/architecture/architecture.md` 只描述包职责与 IPC 通道归属，本次不改变它们。
- 明确的范围外项（各自记录为后续候选）：`confidence` 与 `requiresConfirmation` 在卡片路径被丢弃（`external-tool-pipeline.ts:934-936` 只挑走 `risk` 与 `reasons`），而 `requiresConfirmation` 甚至**没有任何消费者**——审批是否弹卡由 `decision.level` 直接判定（`:926`）；`risk` 与卡片路径取的还是不同源字段（`decision.level` vs `decision.risk`，当前恒等所以不分歧）。
- 验证范围：`pnpm verify`、`pnpm test:e2e`（审批卡片是既有 E2E 覆盖面）、`openspec validate --strict`、`git diff --check`。本变更不改打包配置，不新增平台验证。
