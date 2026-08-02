## Context

当前产品是单用户本地桌面应用：`apps/core` 持有 PTY Session、AgentRuntime、Policy/Approval/Lease/Audit，桌面应用通过 Named Pipe 监督 Core；领域层已有 Agent Conversation / Turn / Task 状态机、Command Transaction、Session Lease 和完整审计模型（ADR-0004~0018）。平台架构探索已确认 A/B 两条接入线（决策 D1–D23，ADR-0019~0031）：

- **A 线（MCP 外部客户端）**：Codex / Claude Code 作为 MCP 客户端调用平台能力；MCP server 内嵌桌面（设置开关 + 回环 HTTP + token）。
- **B 线（ACP 应用内主驾驶）**：opencode 以 ACP 子进程形态接入，平台作为 ACP 客户端声明终端执行与只读文件能力，复用现有 Agent 面板与审批。

本设计覆盖两部分：平台分包重构（前置阶段）与外部 Agent 集成（MCP / ACP 两条线）。分包按平台架构文档第 10~12 节执行：先建立内部边界，再形成独立子包，`apps/core` 收敛为 Composition Root；外部入口（MCP / ACP）作为新模块落在统一 Core API 之上。

## Goals / Non-Goals

**Goals:**

- 按架构文档完成平台分包（阶段一~三）：`apps/core` 平铺实现抽取为独立子包，依赖方向受约束测试保护，Agent / Terminal 可替换验证，功能与进程架构不回归。
- 桌面内嵌 MCP 端点，Codex / Claude Code 经本机 HTTP 调用终端与文件能力，所有调用经过统一 Tool Pipeline。
- ACP 子进程主驾驶（首个实现 opencode），Agent 面板、审批、时间线、审计全部复用。
- 单一安全边界：外部调用（MCP 与 ACP）不可绕过 Policy / Approval / Lease / Audit。
- 内部模型始终看不到 sessionId；外部工具形态（必传 sessionId）在端点层翻译为内部按会话作用域调用。
- 领域层表达 driver 维度（builtin | acp）、可空模型选择与外部调用者审计身份。

**Non-Goals:**

- 不做多用户 / 远程 Core（ADR-0013，D1）；Web 只是本地传输。
- 不实现 CodexAgentAdapter（D2）；Codex / Claude Code 前期仅走 A 线 MCP。
- 不把内置 Agent 暴露为 ACP Server（Q2 留白）。
- 不做不可信 Agent 的进程隔离通道（阶段六）。
- 不新增 CLI / Web / 独立 mcp-server 进程宿主（阶段四）；MCP 仍内嵌桌面（D13）。
- 不做动态插件或独立插件进程（阶段六）；先以包级 Registry 支撑扩展。

## Decisions

1. **模块落点**：MCP server 为桌面内嵌模块（设置开关 + 权限配置 + 回环 HTTP 端点），不新建独立 `apps/mcp-server` 进程（D13 / ADR-0021）。ACP 桥接作为桌面进程监督的子进程宿主，复用 `core-supervisor` 的拉起/退出模式（D16 / ADR-0025）。
2. **传输与认证**：MCP 走本机 HTTP（MCP streamable HTTP 传输），回环监听；Bearer token 由设置页生成/吊销、无过期，吊销即全部失效（D14 / ADR-0021）。
3. **会话寻址**：桌面 UI 提供"复制 sessionId"；外部工具 schema 带必填 sessionId；端点校验 id 必须存在且 Ready，无效 id 拒绝且不泄露其他会话；不提供任何枚举/发现能力（D7 / D8 / ADR-0022）。
4. **执行语义**：每次外部调用 = 独立 Command Transaction + JIT Lease；用户、内置 Agent、外部调用者三方互斥；用户接管与 epoch 失效机制不变（D9 / ADR-0024）。
5. **审批**：MCP 两级配置（read-only：读放行写拒绝；managed：低危自动、高危拒绝），默认拒绝，高危不可配置放行（D4 / D11 / ADR-0023）。ACP permission request 走单一通道：Policy 能自动裁决则回 allow_once，需人批则复用现有审批 UI，非平台工具自动拒绝并审计；不采用 allow_always / reject_always（D17 / ADR-0030）。
6. **领域扩展**：`AgentConversation` 增加 `driver: builtin | acp`；`AgentTurn` 模型选择可空（外部驱动者无平台模型快照）；新增 External Caller、Shared Session、External Agent Process、Conversation Projection 概念（D15 / D20 / ADR-0029、0031）。
7. **ACP 子进程生命周期**：一个 Conversation 对应一个长驻子进程（stdio ACP）；两级开关——设置页"允许 ACP 集成" + 面板选择驱动者并开始任务；进程崩溃 → 当前 Turn 置 failed，用户开启新 Conversation（D22 / ADR-0028）。
8. **状态映射**：ACP stopReason → 现有终态（end_turn/refusal → completed；cancelled → cancelled；max_tokens/max_turn_requests/错误 → failed）；agent_message_chunk / tool_call 更新翻译为现有 timeline 事件（D19 / ADR-0031）。
9. **审计**：外部调用以"外部调用者 + Session"为主体，不伪造 Task/Turn；MCP 与 ACP 均记录来源、命令 hash、审批结果（D10 / ADR-0024）。
10. **能力声明**：ACP 客户端只声明 terminal（终端执行）与 read-only file（只读文件）能力；不声明 edit / search / index（D23 / ADR-0027）。
11. **平台分包**：按架构文档第 10~12 节执行——先在 `apps/core` 内建立目录/接口边界（AgentDriver、TerminalBackend、ToolProvider、Core API 契约），再抽取为独立 workspace 包（application、platform-kernel、agent-service、terminal-service、tooling、model-providers、infrastructure），最后用依赖约束测试与契约测试锁定边界；`apps/core` 只保留 Composition Root 职责。MCP 端点与 ACP 桥接在分包完成后落位，直接消费 Core API，不重复业务与安全逻辑。

## Risks / Trade-offs

- [MCP 审批无 UI，配置遗忘时调用全被拒] → 默认拒绝 + 设置页醒目状态 + 审计可见的拒绝原因。
- [ACP 子进程自带原生工具（opencode 本身可执行命令/读文件），可能绕过平台执行] → 以受限模式启动（如 `opencode acp --pure`）、只声明终端+只读文件能力、进程边界即隔离边界；不承诺防御恶意 Agent（D18）。
- [Codex / Claude Code 后续可能新增 ACP 模式] → 适配层按能力协商而非写死协议面；A 线 MCP 先行，B 线随时可扩展。
- [子进程记忆依赖进程存活，崩溃即丢上下文] → 平台保存 Conversation Projection（消息与工具摘要）供展示/审计/恢复提示，但恢复完整上下文由 Agent 自身能力决定。
- [BREAKING：领域类型变更] → 同步迁移内部消费者与测试；driver 默认 builtin、模型选择可空，保证旧数据兼容读取。
- [双驱动者历史独立，用户可能混淆] → 面板顶部明确驱动者标识与独立历史入口。
- [分包重构是超大范围改动，与外部集成同批落地易回归] → 分包先行且以"行为不变"为验收（全量测试通过后才进入下一阶段）；依赖方向约束测试阻止边界腐化；每批迁移小步提交。
- [先抽包后改类型 vs 先改类型后抽包] → 选择先抽包（模块边界先成立），领域类型变更随后在新包内进行，避免把新概念搬进旧结构。

## Migration Plan

1. **阶段〇/一（平台分包）**：建立模块契约边界 → 划分目录边界（行为不变）→ 抽取独立 workspace 包 → 依赖约束测试 + 契约测试 → `apps/core` 收敛为 Composition Root。
2. **阶段二（领域契约）**：扩展 Conversation/Turn 类型与 External Caller 概念，迁移既有测试；不引入外部功能。
3. **阶段三（A 线 MCP）**：桌面内嵌 MCP 端点、token 生成/吊销、复制 sessionId、两级审批、外部审计身份。
4. **阶段四（B 线 ACP）**：子进程监督、opencode 适配、驱动者切换 UI、单一审批通道、状态映射。
5. **回滚**：MCP/ACP 均以设置开关隔离，关闭后回到纯内置 Agent 行为；领域类型变更向后兼容（nullable + 默认 builtin）；分包重构本身不可回滚为旧平铺结构，但每个子包保留 public API 兼容出口，可小步修正。

## Open Questions

- MCP 传输细节（HTTP+SSE vs streamable HTTP）以所用 MCP SDK 现状为准，实现时确认。
- `opencode acp` 的 stdio 与 `--port` 两种模式：子进程方案默认 stdio，端口模式作为备选。
- 复制的 sessionId 是否需要独立吊销机制（当前 token 无过期；sessionId 泄露的撤销路径待定）。
- MCP 只读文件工具是否与 `terminal_observe` 一起纳入 read-only 能力集（当前倾向纳入）。
