## 1. 阶段一：平台分包与模块边界（前置重构）

- [x] 1.1 定义模块契约：AgentDriver、TerminalBackend、ToolProvider 与 Capabilities 类型落位到 `packages/domain` / `packages/protocol`，明确 Core API 用例契约
- [x] 1.2 将 `apps/core/src` 平铺文件按架构文档第 11 节迁移映射划分目录边界（application / platform-kernel / agent-service / terminal-service / tooling / model-providers / infrastructure），行为不变；包内再按模块划分子目录（domain 的 agent/session/provider 等、terminal-service 的 session/execution/shell/resources/model 等），不再平铺
- [x] 1.3 抽取独立 workspace 包：`packages/application`、`platform-kernel`、`agent-service`、`terminal-service`、`tooling`、`model-providers`、`infrastructure`，以及共享 UI 包 `packages/ui-platform`（agent-history、agent-timeline-state、terminal-output-state、terminal-stream、terminal-view、markdown-content、model-management-page、zh-cn 及视图契约迁入，桌面端仅保留宿主接线），更新 `pnpm-workspace.yaml`、tsconfig 与 package.json 引用
- [x] 1.4 为每个子包建立 public API 出口（index.ts），包间依赖只引用公共 API
- [x] 1.5 编写依赖方向约束测试，阻止反向依赖（domain ← protocol ← infrastructure ← services/tooling ← application/kernel ← apps）
- [x] 1.6 实现 TestAgent 与 MockTerminalBackend 契约测试，验证 Agent/Terminal 可独立替换
- [x] 1.7 将 `apps/core` 收敛为 Composition Root：只组装具体 Adapter、Storage 与 Transport，不再新增业务实现
- [x] 1.8 拆分 `AgentCoordinator` 与 `CoreRequestRouter` 两个上帝类：路由拆为 Session/Agent/Provider/Model/Resource/Audit 六个 RequestHandler + 组合门面；协调器抽出 AgentTimelineProjector、ApprovalAwareGateway 与 AgentState（其余用例组件如 AgentTurnOrchestrator 留待后续按需细化）
- [x] 1.9 运行 `pnpm verify` 全量通过，确认现有功能与测试行为不变后进入下一阶段
- [x] 1.10 将 `apps/desktop/src` 按宿主职责划分子目录：`main`（Electron 主进程、Core 监督与命名管道）、`preload`、`renderer`（视图、样式与状态 Hook）、`shared`（IPC 通道与桥接契约），同步更新 vite 入口、`index.html`、脚本与测试引用
- [x] 1.11 清理 `apps/core/src` 残留：删除无生产引用的 `rejection-messages` 死代码与测试，移除七个空壳目录（agent-service/application/infrastructure/model-providers/platform-kernel/terminal-service/tooling），恢复 Composition Root 单一职责
- [x] 1.12 修正 `scripts/smoke-packaged-core.ts`、`scripts/verify-real-agent.mts` 等脚本对旧桌面/终端包路径的直接引用，改为新子目录路径或公共包 API
- [x] 1.13 运行 `pnpm verify` 全量通过，确认分包整理后行为不变

## 2. 阶段二：领域契约（driver 维度与外部身份）

- [x] 2.1 扩展 `packages/domain` 中 `AgentConversation`：新增 `driver: 'builtin' | 'acp'`（默认 `builtin`），并补充序列化/旧数据兼容测试
- [x] 2.2 扩展 `AgentTurn` / `AgentTask`：外部驱动者的 Task 不要求 `providerProfileId`，`reasoningEffort` 与模型选择允许为空；同步迁移现有构造点与内部消费者
- [x] 2.3 新增领域概念：`ExternalCaller`（外部调用者身份）与 Shared Session 标记（sessionId 仅经用户显式复制后对外可寻址）
- [x] 2.4 为 `Session-Bound Agent Task` 编写领域测试：外部 Task 无 Provider Profile 可通过；模型 Tool 参数携带 `sessionId` 时被 schema 校验拒绝
- [x] 2.5 运行 `pnpm typecheck && pnpm test`，确认领域变更向后兼容（旧数据默认 `builtin`、模型选择可空）

## 3. 阶段三：A 线 MCP（桌面内嵌端点）

- [x] 3.1 在分包后的桌面端/入口模块新增 MCP 端点实现：内嵌运行、仅监听本机回环地址，HTTP 传输（以所用 MCP SDK 现状为准：streamable HTTP 或 HTTP+SSE），只依赖 Core API
- [x] 3.2 设置页新增 MCP Server 启用/禁用开关与醒目状态展示；启用后提供连接串（回环地址 + token）复制入口
- [x] 3.3 实现 token 生成与吊销（持久化、无过期、吊销即全部失效），新调用与未完成调用均被拒绝
- [x] 3.4 定义外部工具形态：终端执行与 `terminal_observe`（及 read-only 文件工具）带必填 `sessionId`；`packages/protocol` 内部 schema 保持不含 `sessionId`，翻译只发生在端点层
- [x] 3.5 实现 sessionId 校验：仅接受用户复制过且存在、Ready 的 id；无效 id 返回稳定错误且不泄露会话存在性；不提供任何枚举/发现工具
- [x] 3.6 桌面 UI 提供"复制 sessionId"入口（Shared Session 语义），复制动作不改变 Session 状态、Lease 或安全边界
- [x] 3.7 实现外部审批配置（read-only / managed 两级、默认拒绝，destructive 与 unknown 高危不可配置放行）并接入 `PolicyEngine`
- [x] 3.8 外部调用接入统一 Tool Pipeline：每个调用作为独立 Command Transaction + JIT Lease；与用户、内置 Agent 三方互斥；用户接管 epoch 递增使外部执行令牌失效
- [x] 3.9 `terminal_observe` 对 MCP 外部调用按读操作放行，返回前经过现有脱敏管线，本地终端显示不受影响
- [x] 3.10 审计以"外部调用者 + Session"为主体（来源 MCP、sessionId、命令哈希、风险、审批结果、时间），不创建伪造 Task/Turn
- [x] 3.11 为 A 线编写协议级/集成测试：默认拒绝、managed 低危放行、高危拒绝、无效 id 不泄露、token 吊销、接管失效、observe 脱敏
- [x] 3.12 运行 `pnpm typecheck && pnpm test` 与相关 e2e，验证 MCP 开关关闭后外部调用全部失败且无残留端点进程

## 4. 阶段四：B 线 ACP（外部 Agent 主驾驶）

- [x] 4.1 新增 ACP 桥接模块（桌面进程内监督子进程，复用 `core-supervisor` 的拉起/退出模式）；仅在两级开关都满足时 spawn（设置页允许 ACP 集成 + 面板选择驱动者并开始任务）
- [x] 4.2 实现 ACP 客户端能力声明：只声明 terminal（终端执行）与 read-only file；外部 Agent 请求未声明能力时拒绝并审计
- [x] 4.3 实现首个 Agent 适配层：`opencode acp`（默认 stdio、`--port` 模式备选），按能力协商适配而非写死协议面
- [x] 4.4 实现单一审批通道：Policy 可自动裁决时返回 `allow_once`，需人批复用现有审批 UI，非平台工具自动拒绝并审计；不采用 allow_always / reject_always
- [x] 4.5 实现 ACP 事件翻译：`agent_message_chunk` 与 tool_call 更新映射为现有 timeline 事件；stopReason 映射终态（end_turn/refusal → completed、cancelled → cancelled、max_tokens/max_turn_requests/错误 → failed）
- [x] 4.6 实现 Conversation Projection 存储（user_text、assistant_text、工具调用摘要），供展示/审计/恢复提示；完整上下文仍由外部 Agent 进程自管，平台不回放投影
- [x] 4.7 Agent 面板顶部新增驱动者切换（builtin | acp），内置与外部历史各自独立，切换驱动者时显示对应历史
- [x] 4.8 实现子进程生命周期收尾：Conversation 关闭或应用退出终止子进程；进程崩溃 → 当前 Turn 置 failed、不自动重启、用户开启新 Conversation 时重新 spawn
- [x] 4.9 为 B 线编写测试：未开始任务不 spawn、驱动者切换历史隔离、单一审批通道、能力拒绝、崩溃映射、关闭即终止
- [x] 4.10 运行 `pnpm typecheck && pnpm test` 与相关 e2e，确认关闭全局 ACP 开关后行为回到纯内置 Agent

## 5. 阶段五：端到端验收与收尾

- [x] 5.1 手工验收 A 线：Codex / Claude Code 通过连接串调用终端执行与 observe，验证权限配置、sessionId 寻址、用户接管与审计展示
- [x] 5.2 手工验收 B 线：opencode 作为外部驱动者完成一次任务，验证驱动者切换、单一审批通道、时间线与审计
- [x] 5.3 运行 `pnpm verify` 全量通过；确认没有为本变更额外生成 `docs/superpowers` 双轨文档
- [x] 5.4 依据实现结果更新 `dev/terminal-agent-platform-architecture.md` 与 CONTEXT.md 中与本变更不一致的细节，标注落地状态
