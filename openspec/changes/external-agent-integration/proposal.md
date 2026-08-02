## Why

Terminal Agent 目前只有内置 Agent 和桌面入口：Codex、Claude Code 等外部客户端无法调用平台能力，opencode 等 ACP Agent 也无法作为应用内主驾驶复用现有面板与安全管线。平台架构探索已确认完整决策（D1–D23 及 ADR-0019~0031），本变更把这些决策落地为可实现的契约、设计与任务。

## What Changes

- 平台分包重构（前置阶段）：按平台架构文档的分层计划，将 `apps/core` 平铺实现抽取为 `application` / `platform-kernel` / `agent-service` / `terminal-service` / `tooling` / `model-providers` / `infrastructure` 等子包，`apps/core` 收敛为 Composition Root；建立依赖方向约束与契约测试，保证 Agent / Terminal 可替换。
- 新增 MCP 访问能力：桌面内嵌 MCP server（设置开关、回环 HTTP、可吊销 token），Codex / Claude Code 作为外部客户端调用终端与文件能力；MCP 审批为配置驱动、默认拒绝（read-only / managed 两级）。
- 外部调用通过"用户从桌面复制的 sessionId"寻址，调用必传且无枚举能力；每次调用是独立 Command Transaction + JIT Lease，与用户、内置 Agent 三方互斥。
- 新增 ACP 主驾驶能力：spawn Agent CLI 子进程（首个实现 `opencode acp`），平台作为 ACP 客户端声明"终端执行 + 只读文件"能力；一个 Conversation 对应一个长驻子进程，仅由显式用户动作启动。
- Agent Conversation 增加 driver 维度（builtin | acp），外部驱动者的模型选择可空，内置与外部历史各自独立；Agent 面板顶部提供驱动者切换。
- 单一审批通道：ACP permission request 由平台 Policy 裁决（自动 allow_once、现有审批 UI、非平台工具拒绝并审计），不采用 allow_always/reject_always 记忆语义。
- 审计引入"外部调用者 + Session"身份，不为外部调用伪造 Task/Turn；外部 Agent 自管上下文，平台只存展示/审计/恢复用投影。
- **BREAKING**：`AgentConversation` / `AgentTurn` 领域类型变更（新增 driver 维度、模型选择可空），影响依赖这些类型的内部消费者。

## Capabilities

### New Capabilities

- `core-modularization`: 平台分包能力——分层包边界、依赖方向约束、Composition Root 职责、Core API 单一入口、可替换后端契约验证。
- `mcp-access`: MCP 端点能力——内嵌桌面形态、token 认证、sessionId 寻址、两级审批配置、外部调用审计身份。
- `acp-driver`: ACP 外部 Agent 主驾驶能力——子进程生命周期、客户端能力声明、单一审批通道、Turn 状态映射、会话绑定与投影存储。

### Modified Capabilities

- `agent-execution`: Turn/Task 支持 driver 维度与可空模型选择；外部驱动者进入执行互斥（JIT Lease、用户接管）。
- `terminal-sessions`: Session 可被用户显式共享（Shared Session），外部调用者通过复制的 id 寻址；无枚举、无效 id 不泄露。
- `terminal-safety-audit`: 审计主体扩展为"外部调用者 + Session"；MCP/ACP 审批策略归属与默认拒绝语义。

## Impact

- 仓库结构：新增 `application`、`platform-kernel`、`agent-service`、`terminal-service`、`tooling`、`model-providers`、`infrastructure` 等 workspace 包；`apps/core` 由承载全部实现收敛为 Composition Root。
- 桌面应用：新增 MCP 端点模块与 ACP 子进程监督（复用 core-supervisor 模式）；Agent 面板驱动者切换、设置页开关、复制 sessionId 入口。
- `packages/domain`：agent-conversation / agent-task 类型扩展，新增 External Caller、Agent Driver、Shared Session 等概念。
- `packages/protocol`：外部工具形态（带 sessionId）与内部无 sessionId schema 分离，端点层做翻译。
- 安全管线：Policy / Approval / Lease / Audit 保持唯一执行通道；token 与子进程边界是新增隔离面。
- 迁移风险：分包重构与外部集成同批落地，通过依赖约束测试、契约测试与全量回归控制；分包先行，新功能直接落在新模块。
