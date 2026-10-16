# Design

## Context

动机见 `proposal.md` 的 Why。这里只记录塑造方案的现状事实：

- `PolicyDecision.reasons: string[]`（`packages/mcp-runtime/src/mcp/policy-engine.ts:9`），产出点是**引擎 15 处**散落字面量（`:103,112,113,141,144,147,168,173,176,188,194,201,205,209,213`），其中 5 处内插可执行文件名；另有 `external-tool-pipeline.ts:971` 一处自由输入的硬编码理由。`unique(reasons)` 只做去重（`:151`）。
- 理由出门后有**两条路径**：审批卡片（`ApprovalRequest.reasons` → `ApprovalQueue` → `mcp:approval` → `contracts.ts:77` → `approval-card.tsx`）与对外证据（`riskEvidence.reasons` → 工具响应）。前者今天靠 `formatReason` 的正则＋`Map` 反解析，后者全程原样透传。
- 展示文案的既有分工：风险等级标签 `RISK_LABELS` 在 renderer（`approval-card.tsx:6-12`）；`apps/desktop/src/renderer/i18n/zh-cn.ts` 已有 `sessionPtyStatusZh` / `errorMessageZh` 两个「码 → 中文」映射。领域模型与 `docs/reference/mcp-tools.md` 都不含显示文案，后者也没有记录 `reasons` / `confidence` / `requiresConfirmation` 字段。
- renderer 侧的审批类型来自 `apps/desktop/src/shared/contracts.ts:1-8`，它直接从 `@synapse-term/mcp-runtime` 导入并再导出（`:77 McpApprovalRequest = VisibleApprovalRequest`），因此新增词表不需要新的依赖方向。
- `PolicyDecision.commandHash`（`:11`）每次分类计算一次 SHA-256，**全仓无人读取**。

## Goals / Non-Goals

**Goals:**

- 让理由以结构化结论穿过 seam：词汇表成为显式联合类型，展示层不再反解析散文。
- 让「新增一条规则」在展示层**不写文案即编译失败**，消灭静默漏英文这一类问题。
- 对外的工具响应契约（`reasons` 的字符串内容）逐字不变。

**Non-Goals:**

- 不改风险分类的判定逻辑与阈值，不重写任何英文措辞。
- 不把 `confidence` / `requiresConfirmation` 补进审批卡片，也不让 pipeline 开始消费 `requiresConfirmation`（那是另一套语义决策）。
- 不合并 `decision.level` 与 `decision.risk` 这两个同值字段（当前恒等，无从判断哪一个是有意保留的对外源）。
- 不改领域类型、不改稳定错误码、不改 MCP 工具响应字段集合、不新增 ADR。

## Decisions

### 1. 词表是显式联合类型，由运行时数组派生，落在 `mcp-runtime`

新增 `packages/mcp-runtime/src/mcp/risk-reasons.ts`：

```ts
export const RISK_REASON_CODES = [
  'empty-command',
  'command-substitution-unproven',
  'privilege-escalation',
  'redirection-changes-filesystem',
  'read-only-rules-matched',
  'dynamic-shell-structure',
  'unknown-executable',
  'unknown-powershell-executable',
  'destructive-command',
  'irreversible-destructive-command',
  'destructive-system-command',
  'state-changing-command',
  'sysctl-kernel-state',
  'sort-output-file',
  'free-input-writes-to-pty',
] as const;

export type RiskReasonCode = (typeof RISK_REASON_CODES)[number];
```

- 由数组派生联合类型，与前一个 change 的 `STABLE_EXTERNAL_ERROR_CODES` 同一手法：测试能遍历一份**真实存在的清单**断言两张表都覆盖，而不是遍历表的键（后者对「表里多了一个不存在的 code」无感）。
- **落 `mcp-runtime` 而不是 `domain`**：选 Decision 3 之后对外形态不变，`domain` 的 `CommandRiskEvidence.reasons` 一个字符都不用改，把词表放进 `domain` 会凭空改动领域类型；而 renderer 已经通过 `shared/contracts.ts` 从 `mcp-runtime` 取审批类型。这些 code 是**策略引擎的规则词汇**（规则就写在 `policy-engine.ts` 里），不是领域概念。
- **替代：放 `domain`**——否决，理由同上。**替代：只写类型联合、不留运行时清单**——否决，守护测试会退化成遍历表的键。

### 2. 形态是判别联合，需要 `subject` 的 code 在类型上必须带它

```ts
type SubjectlessRiskReason =
  | { code: 'empty-command' }
  | { code: 'command-substitution-unproven' }
  /* ...引擎中不带参数的那些规则 */
  ;

type SubjectRiskReason =
  | { code: 'unknown-executable'; subject: string }
  | { code: 'unknown-powershell-executable'; subject: string }
  | { code: 'destructive-command'; subject: string }
  | { code: 'irreversible-destructive-command'; subject: string }
  | { code: 'destructive-system-command'; subject: string }
  | { code: 'state-changing-command'; subject: string }
  ;

export type RiskReason = SubjectlessRiskReason | SubjectRiskReason;
```

- 不用「`{ code, subject?: string }` ＋ 渲染时兜底」：那样 `destructive-command` 漏带 subject 时渲染出 `undefined has destructive semantics`，而今天所有内插点都必然有名字（字面量就是内插出来的）。判别联合把这条不变量变成类型约束，与前一个 change 的 `ExternalWritePremise` 同一手法。
- 不保留 `detail` 散文副本：两份表示会漂移，而选 Decision 3 之后没有任何消费者需要它。

### 3. 两条出口：对内传 code，对外渲染成字符串

| 出口 | 形态 | 消费者 |
| --- | --- | --- |
| `ApprovalRequest.reasons` → `ApprovalQueue` → `mcp:approval` → `shared/contracts.ts` | `readonly RiskReason[]`（**形态变化**） | renderer，按 code 查中文表 |
| `riskEvidence.reasons` → MCP 工具响应 | `string[]`，由 `renderRiskReasonEn` 渲染 | 外部 MCP 客户端（**逐字不变**） |

- 卡片路径必须是 code，否则 renderer 仍要反解析——那正是本次要消除的东西。
- `ApprovalRequest.reasons` 变形态属于 **main ↔ renderer 的实现契约**：`docs/architecture/architecture.md:67` 明确「具体 channel 名称属于 Desktop 实现契约」，而 `docs/reference/mcp-tools.md` 也没有记录这些字段，因此不构成对外契约变更。
- **替代：对外也传 `{code, subject}`**——否决，让外部客户端为同一事实换一种表示，功能性收益为零却要动对外契约。**替代：内部同时携带 code 与英文文案**——否决，同一事实两份表示。

### 4. 英文表逐字保留今天的措辞，并落 `mcp-runtime`

`renderRiskReasonEn(reason)` 覆盖全部 15 个 code，**输出与今天的字面量逐字相同**，包括两条刻意保留的不一致（`has destructive semantics` 与 `has destructive system semantics`）。

| code | 今天的字面量位置 | 渲染结果 |
| --- | --- | --- |
| `empty-command` | `policy-engine.ts:103` | `empty command` |
| `command-substitution-unproven` | `:112` | `command substitution is not proven safe` |
| `privilege-escalation` | `:113` | `command requests privilege escalation` |
| `redirection-changes-filesystem` | `:141` | `redirection can change filesystem state` |
| `read-only-rules-matched` | `:144` | `all commands match read-only rules` |
| `dynamic-shell-structure` | `:147` | `scripts, aliases, or dynamic shell structure cannot be fully expanded safely` |
| `destructive-command` | `:168` | `${subject} has destructive semantics` |
| `state-changing-command` | `:173` 与 `:209`（同一模板两处） | `${subject} can change system state` |
| `unknown-powershell-executable` | `:176` | `unknown PowerShell executable: ${subject}` |
| `sysctl-kernel-state` | `:188` | `sysctl write options can change kernel state` |
| `sort-output-file` | `:194` | `sort can change filesystem state with -o/--output` |
| `irreversible-destructive-command` | `:201` | `${subject} has irreversible destructive semantics`（字面量的 `rm` 就是 `subject`） |
| `destructive-system-command` | `:205` | `${subject} has destructive system semantics` |
| `unknown-executable` | `:213` | `unknown executable: ${subject}` |
| `free-input-writes-to-pty` | `external-tool-pipeline.ts:971` | `free input writes directly to the current PTY` |

计数口径：引擎 15 处字面量 → **14 个 code**（`:173` 与 `:209` 共用 `state-changing-command`）；加上 pipeline 的自由输入那一处 → 词表共 **15 个 code**。

- 不顺手统一措辞（Decision 4 的取舍见 `proposal.md`）：逐字保留让「对外 payload 不变」可被机械验证；措辞统一属于另一条需要 delta spec 的改动。
- **替代：允许归一化措辞**——否决，会把一个展示层修复变成对外契约变更。

### 5. 中文表落 `renderer/i18n/zh-cn.ts`

`approval-card.tsx` 删除三条正则、`Map` 与死条目 `'irreversible'`，改为调用 `zh-cn.ts` 里的新映射（与既有的 `sessionPtyStatusZh` / `errorMessageZh` 并列）。

- 展示文案不进领域模型，也不进 `mcp-runtime`：风险等级标签 `RISK_LABELS` 本来就在 renderer。
- 两条今天显示中文的理由（`unknown executable: X` 与 `unknown PowerShell executable: X`，正则把方言当成可选而忽略）保持**逐字相同的中文**；方言区分从此在类型上可用，但不改变现有文案。
- 映射用 `satisfies` 约束穷尽，新增 code 不写文案即编译失败；原先「查不到就原样吐英文」的兜底分支随之消失。

### 6. 删除只写不读的 `commandHash`

`PolicyDecision.commandHash`（`:11`）、`:101` 的计算与 `decision()` 的形参一并删除。它与候选 #1 的 `ActiveRun.inputRecords`、候选 #2 的 `record.resolve/reject` 同类：留着会让下一个读者以为它被消费；而 `PolicyDecision` 正是本次要改的类型，属于同一处的清理。

### 7. 不补 `confidence` / `requiresConfirmation`，也不消费 `requiresConfirmation`

- 卡片 spec（`openspec/specs/mcp-access/spec.md:321-322`、`:336-338`）只要求展示**风险分类理由**；对 `confidence` 的要求落在**分类结果**上（`:101-103`），而分类结果确实携带它（走 `riskEvidence`）。今天丢的只是卡片这一路。
- `requiresConfirmation` 不被任何地方消费（审批是否弹卡由 `decision.level` 决定）是**另一件事**：它是「有意保留的对外声明」还是「实现副产品」需要单独评估，混进来会让这个 diff 的意图说不清。

### 8. 无规格变更

以 `.openspec.yaml` 的 `skip_specs: true` 声明。对外工具响应的 `reasons` 字符串逐字不变、错误码不变；唯一的可观察差异是审批卡片上此前漏英文的 5 条理由变为中文，而卡片 spec 只要求「展示风险分类理由」，未规定语言与措辞，因此不产生 requirement 级别的变化。

## Risks / Trade-offs

- [对外的英文串被无意改动] → 新模块的测试**枚举全部 15 个 code** 断言渲染结果，其中 5 条带 subject 的用真实 `subject` 值对照今天的字面量；并把「工具响应逐字不变」列为安全停止条件。
- [卡片中文文案被无意改动] → 今天显示正确中文的理由，其 code → 中文映射必须与正则/`Map` 的输出逐字相同；renderer 测试断言。
- [`ApprovalRequest.reasons` 形态变化] → 它是 main ↔ renderer 的实现契约（`architecture.md:67`），且 mock 与真实路径共用同一类型、同一中文表，形态错配会在 `pnpm typecheck` 阶段暴露，而不是运行时静默。
- [新增 code 忘记写文案] → 两张表都由 `satisfies Record<RiskReasonCode, …>` 约束；再加一条遍历 `RISK_REASON_CODES` 的测试，覆盖「表里多了一个不存在的 code」这类反向错误。
- [需要 subject 的 code 漏带 subject] → 判别联合在类型上强制（Decision 2）。
- [本次只修展示层，根因未除] → 根因是词表用散文编码，Decision 1 与 2 消除的正是它：词汇表成为显式联合类型后，下一条规则无法再「悄悄漏英文」。

## Migration Plan

- 无数据迁移、无持久化状态、无打包配置变更。三条路径形态同步改（引擎产出、卡片路径、对外渲染），不存在需要兼容的中间格式。
- 安全停止条件：逐字对照**对外英文串**（必须完全不变）与**卡片中文文案**（只有此前漏英文的 5 条可变）；随后全量测试、`pnpm test:e2e`（审批卡片是既有 E2E 覆盖面，会顺带验证 mock 路径的中文渲染）。
- 文档闭环：`CONTEXT.md` 不新增词条——code 词表是实现词汇，而「风险分类」「审批卡片」等已覆盖本次涉及的领域概念；不新增 ADR——本次是行为不变的展示修复加内部形态收敛，不影响对外契约且易于回退。
