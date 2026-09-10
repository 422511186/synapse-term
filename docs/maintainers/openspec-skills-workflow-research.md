# OpenSpec `config.yaml` 与仓库技能工作流研究

日期：2026-09-10  
OpenSpec CLI：`1.12.0`  
仓库：`synapse-term`

## 结论摘要

1. `openspec/config.yaml` 是项目级配置，不是工作流 schema 本身。它应保持短小、可审阅，并只放项目事实、artifact 规则、apply/archive 的操作建议，以及确实需要的 root/store 集成字段。
2. `context` 会注入所有 artifact 和 apply/archive 指令；`rules` 只注入同名 artifact；`operations.apply/archive.guidance` 是独立的 advisory guidance。三者都是 prompt-level 输入，不是 CLI 强制检查，也不应被当作安全策略或验证器。
3. `.agents/skills/` 是 OpenSpec 支持的 shared skills 交付目标（`--tools agents`；Codex 也使用该共享根）。它承载可触发的流程技能，而不是由 `config.yaml` 直接“调用”。配置文件应描述技能协作边界和项目约束；具体的探索、提案、实现、同步、归档步骤由技能文件执行。
4. 生产项目最稳妥的默认仍是内置 `spec-driven`：`proposal -> specs -> design -> tasks`。只有流程确实改变时才 fork/安装 project-local schema，并用 `openspec schema validate` 验证。
5. 对本仓库而言，现有中文结构关键字规则、领域上下文、单一事实源和验证要求方向正确；重整时应把“事实约束”与“行为流程”分开，避免把所有技能说明堆入 `context`，并考虑用 `operations` 表达 apply/archive 的通用建议。

## 研究范围与本地约束

改动前已读取：

- [`CONTEXT.md`](../../CONTEXT.md)：Session、MCP、审批模式、单用户本地边界等术语和硬边界。
- 生效 ADR：[`docs/adr/0001-local-core-owns-terminal-sessions.md`](../adr/0001-local-core-owns-terminal-sessions.md)、[`0002-terminal-sessions-are-transport-agnostic.md`](../adr/0002-terminal-sessions-are-transport-agnostic.md)、[`0013-single-user-local-product-boundary.md`](../adr/0013-single-user-local-product-boundary.md)、[`0020-runtime-package-modularization.md`](../adr/0020-runtime-package-modularization.md)、[`0022-documentation-information-architecture.md`](../adr/0022-documentation-information-architecture.md) 及 ADR 索引。
- 仓库内现有 `.agents/skills/openspec-*`、`tdd`、`domain-modeling`、`grilling`、`research`、`code-review` 等技能。
- 当前 [`openspec/config.yaml`](../../openspec/config.yaml)：`schema: spec-driven`，以长 `context` 描述中文 artifact 约定和技能协作，以 `rules` 约束 proposal/specs/design/tasks。

本次研究没有修改 `openspec/config.yaml`。

## OpenSpec 项目配置的实际 schema

以下结论来自 OpenSpec v1.12.0 的官方配置参考 [`docs-lab/reference/configuration/config-yaml.md`](https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs-lab/reference/configuration/config-yaml.md) 与一手实现 [`src/core/project-config.ts`](https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/src/core/project-config.ts)；本机安装包对应实现位于 `@fission-ai/openspec@1.12.0/dist/core/project-config.js`。

| 字段 | 实际形状/语义 | 整理建议 |
| --- | --- | --- |
| `schema` | 非空字符串；用于选择内置或 project-local schema | 保留为首字段，当前 `spec-driven` 合理 |
| `context` | 可选字符串；UTF-8 最大 50 KiB；注入 artifact instructions，也作为 apply/archive 的 project context | 只写稳定的技术栈、领域边界、文档语言和事实源；避免重复模板和长流程脚本 |
| `rules` | `artifact id -> string[]`；只传给匹配的 artifact；空字符串会被丢弃；未知 artifact id 会发出 warning | 每条规则短、可执行、归属于一个 artifact；不要把 apply/archive 行为写在这里 |
| `operations.apply.guidance` | 可选字符串数组；仅 apply 操作的 advisory guidance | 适合“实现后必须运行哪些项目命令”等跨任务建议，但不能代替任务或 CI |
| `operations.archive.guidance` | 可选字符串数组；仅 archive 操作的 advisory guidance | 适合归档前复核、同步和总结提示；不写成强制状态机 |
| `store` | 可选字符串；config-only 目录下的 store 指针，是 fallback，不覆盖本地 planning shape | 单仓库本地规划通常省略；只有使用 registered store 才声明，并配合 `openspec store` 工作流 |
| `references` | 解析器额外支持字符串或 `{id, remote}` 列表并规范化去重 | 只有跨 store 复用上下文时使用；不要把它当作普通文件引用列表 |
| `githubCopilot.cloudAgent` | 可选布尔值，记录是否 opt-in 生成 GitHub Copilot cloud-agent 文件 | 本仓库未请求该集成，保持省略或显式 false，不能把它与 `.agents/skills` 混为一谈 |

解析器是“逐字段容错”的：某字段非法会 warning 并尽量保留其他有效字段；配置文件不是 YAML object 或无法解析时整体被忽略。`context` 超过 50 KiB 会被忽略。规则键会针对所有可用 schema 的 artifact id 做 warning 检查。来源：上述 `project-config.ts` 的 `readProjectConfig`、`validateConfigRules` 和 `MAX_CONTEXT_SIZE`。

## 配置、schema、技能三层边界

官方定制指南将项目定制分为三层：Project Config、Custom Schemas、Global Overrides。项目配置负责默认 schema、context、per-artifact rules、per-operation guidance 和 Copilot 选择；自定义 schema 才负责 artifact 图、模板和依赖关系。来源：官方 [`docs/customization.md`](https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs/customization.md)。

因此建议保持以下边界：

```text
openspec/config.yaml
  = 项目事实 + prompt 约束 + 操作建议

openspec/schemas/<name>/
  = artifact 类型、模板、依赖图、schema-specific instructions

.agents/skills/openspec-*/SKILL.md
  = AI 触发入口、工作流步骤、读写边界、CLI 编排
```

不要为了“融合技能”把每个技能的完整正文复制进 `context`。这样会造成两套事实源，超过 context 限额，并且下一次 `openspec update` 或技能更新后容易漂移。`context` 只应告诉 agent 哪些技能适用、何时切换，以及本仓库不可违反的事实；技能正文继续留在 `.agents/skills/`。

## Schema 选择与验证

官方定制指南给出的 schema resolution order 是：

1. CLI `--schema`；
2. change metadata（变更目录内 `.openspec.yaml`）；
3. `openspec/config.yaml`；
4. 默认 `spec-driven`。

来源：[customization.md 的 Schema Resolution Order](https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs/customization.md#schema-resolution-order)。

自定义 schema 应位于 `openspec/schemas/<name>/`，可用 `openspec schema fork spec-driven <name>` 起步，用 `openspec schema validate <name>` 校验模板、依赖和循环，再在 config 中设置 `schema: <name>`。schema 的 project > user > package 解析优先级，以及 `schema which` 调试方式，见官方 [`docs/customization.md`](https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs/customization.md) 与 [`docs/cli.md`](https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs/cli.md)。

当前本仓库执行 `openspec validate --all` 的结果为 15 项通过、0 项失败；因此本次整理不应无必要地替换 `spec-driven` 或引入新 schema。

## 官方推荐的工作流习惯

官方工作流文档把 OPSX 描述为 fluid actions，而非不可回退的阶段锁：探索和验证是可选动作，计划可以在实现中更新。默认 core profile 包含 `explore`、`propose`、`apply`、`update`、`sync`、`archive`；扩展 profile 才加入 `new`、`continue`、`ff`、`verify`、`bulk-archive`、`onboard`。来源：[`docs/workflows.md`](https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs/workflows.md) 与 [`docs/commands.md`](https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs/commands.md)。

官方审查指南给出两个关键检查点：

- `propose`/`ff` 之后、写代码之前审计划：先 proposal，再 delta specs，再 design/tasks；
- 实现后用 `verify`（或等价的人工复核）检查 completeness、correctness、coherence，再 archive。

来源：[`docs/reviewing-changes.md`](https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs/reviewing-changes.md)。

官方团队指南还强调 OpenSpec 不操作 Git；变更目录应和代码一起提交，单个 change 尽量由一个 owner 维护，归档时再把 delta specs 合并到共享 `openspec/specs/`。来源：[`docs/team-workflow.md`](https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs/team-workflow.md)。

## `.agents/skills` 的官方交付方式与边界

OpenSpec v1.12.0 的 supported-tools 文档把 `agents` 定义为 vendor-neutral shared `.agents/skills/` 目标；Codex 和 Zed Agent 也共用该 canonical root。选择 `agents` 时只生成 skills，不生成 command adapter；通过 `openspec init --tools agents` 初始化，后续 `openspec update` 刷新。来源：[`docs/supported-tools.md`](https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs/supported-tools.md#when-to-pick-the-shared-agents-target)。

官方实现为共享根写入 `.agents/skills/.openspec-target` marker，并只管理 `openspec-*` 技能目录和 marker；其他用户技能应保留。当前仓库的 marker 内容为 `codex`，且 OpenSpec 技能目录与大量非 OpenSpec 技能并存。来源：本机 `@fission-ai/openspec@1.12.0/dist/core/shared-skill-target.js`、`dist/core/config.js` 与仓库 `.agents/skills/.openspec-target`。

这意味着配置重整应：

- 明确 `.agents/skills/openspec-*` 是 OpenSpec 生命周期入口；
- 明确 `tdd`、`domain-modeling`、`grilling` 等是协同技能，按任务触发，不复制其正文；对不存在的技能路径不做路由声明。
- 把“何时使用哪个技能”写成简短路由规则，把“怎么执行”留在各技能 `SKILL.md`；
- 保留 `openspec-explore` 的“探索不实现”、`openspec-propose` 的“只产计划”、`openspec-apply-change` 的“实现 tasks”、`openspec-sync-specs` 的“同步 delta”、`openspec-archive-change` 的“完成后归档”等职责分界。

上述职责来自仓库内相应技能文件，而非 OpenSpec config schema；它们是本仓库的协作约定，应视为技能层事实源。

## 社区 schema 与技能融合的可复用模式

社区资料不能替代 OpenSpec 核心契约，但可作为“不要把集成硬编码进核心”的实践证据：

1. `intent-driven-dev/openspec-schemas` 将 schema 作为可复制的 `openspec/schemas/` bundle；其 schema 可附带 `skills.txt`，安装指南再把 companion skills 安装到项目 `.agents/skills/`。这把 artifact workflow 与技能实现分开，同时提供一键对齐。来源：[仓库 README](https://github.com/intent-driven-dev/openspec-schemas/blob/main/README.md) 与其 `AGENT_INSTALL.md`。
2. `JiangWay/openspec-schemas` 的 `superpowers-bridge` 采用独立社区仓库，理由是避免 OpenSpec core 承担第三方工具的 release cadence；bridge 把 brainstorming、writing-plans、TDD、review、finishing 等 execution skills 接到 OpenSpec artifact governance。来源：[仓库 README](https://github.com/JiangWay/openspec-schemas/blob/main/README.md)。
3. OpenSpec 官方社区 schema catalog 收录 `anvil`：`proposal -> specs -> design -> review -> test-plan -> tasks -> apply -> verify`，并明确 review gate 需要项目自己的 CI/hook 执行，因为 OpenSpec 只检查 artifact 是否存在。来源：[官方 customization.md 的 Community Schemas](https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs/customization.md#community-schemas)。

对本仓库的可取做法是：继续使用内置 schema，采用技能层组合来获得 TDD、领域建模、代码审查和研究；只有当 artifact 依赖图本身需要 review/test-plan/ADR 等新节点时，才引入 project-local/community schema。不要把“技能存在”误写成“OpenSpec 已强制执行”；需要强制的检查应进入 tasks、CI 或验证命令。

## 对当前配置的逐项建议（供后续实现者使用）

### 保留

- `schema: spec-driven`。
- 中文正文、英文结构标题/规范关键字的语言约定；这与官方多语言指南一致：结构标题和 `MUST`/`SHALL` 保持英文，周边 prose 可用中文。来源：[`docs/multi-language.md`](https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs/multi-language.md#quick-setup)。
- 领域硬边界和单一事实源规则，但应精简为稳定事实，不复制 ADR 全文或技能全文。
- 目前 proposal/specs/design/tasks 的 artifact-specific rules。

### 重排或拆分

- 将 context 分为“语言/文档格式”“领域/架构事实”“OpenSpec 与技能路由”“验证入口”四个短小段落，便于 agent 读取。
- 将“完成实现后运行验证命令”的普适建议移到 `operations.apply.guidance`；将归档前复核、同步和变更单一事实源建议移到 `operations.archive.guidance`。这些 guidance 仍是 advisory，应继续在技能和项目命令中实际执行。
- 在 context 中明确：`openspec/config.yaml` 只提供约束与路由；各 `.agents/skills/*/SKILL.md` 是步骤事实源；活跃 change artifacts 是该 change 的唯一事实源。
- 规则句尽量一条一个可观察动作，避免长句把多个检查混成不可验证的 prompt。

### 谨慎新增

- 不为本地单仓库随意加入 `store`、`references` 或 `githubCopilot`。
- 不把 `.agents/skills` 路径写成 OpenSpec schema 的字段；技能交付由 `openspec init/update` 和 agent 工具约定负责。
- 不为“更强流程”直接切换社区 schema；先证明当前 spec-driven + skills + `pnpm verify` 不能满足，再建立 change 并验证新 schema。

## 可复现实验与验证记录

在仓库根目录执行：

```text
openspec --version                         # 1.12.0
openspec schemas --json                    # spec-driven，proposal/specs/design/tasks
openspec context --json                    # 当前仓库为 nearest openspec root
openspec doctor --json                     # healthy: true
openspec validate --all                    # 15 passed, 0 failed
openspec instructions proposal --change add-terminal-file-transfer-and-status --json
openspec instructions apply --change add-terminal-file-transfer-and-status --json
openspec instructions archive --change add-terminal-file-transfer-and-status --json
```

`instructions proposal` 返回当前 `context` 与匹配的 `rules`；`instructions apply/archive` 返回当前 `context`，而当前配置未设置 `operations`，所以 `operationGuidance` 为 `null`。这验证了三类输入在 CLI 输出中的分离。

## 来源索引

- OpenSpec v1.12.0 commit：<https://github.com/Fission-AI/OpenSpec/commit/e062b9572be933564ba3899d059377dfa1393e32>
- Config YAML 官方参考：<https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs-lab/reference/configuration/config-yaml.md>
- Project config 定制说明：<https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs-lab/customize/project-config.md>
- Skills 官方参考：<https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs-lab/reference/skills.md>
- Project config 实现：<https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/src/core/project-config.ts>
- Project customization / community schemas：<https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs/customization.md>
- Workflows：<https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs/workflows.md>
- Commands / CLI：<https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs/commands.md>；<https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs/cli.md>
- Supported tools and shared `.agents` target：<https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs/supported-tools.md>
- Multi-language：<https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs/multi-language.md>
- Reviewing changes：<https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs/reviewing-changes.md>
- Team workflow：<https://github.com/Fission-AI/OpenSpec/blob/e062b9572be933564ba3899d059377dfa1393e32/docs/team-workflow.md>
- Community intent-driven schemas：<https://github.com/intent-driven-dev/openspec-schemas/blob/main/README.md>
- Community superpowers bridge：<https://github.com/JiangWay/openspec-schemas/blob/main/README.md>







