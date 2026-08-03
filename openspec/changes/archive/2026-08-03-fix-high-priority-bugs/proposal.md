## Why

BUG_REPORT.md（共 194 项）中优先级最高的 2 个 Critical 与 16 个 High 缺陷：分布在进程终止、Agent 协调器状态一致性、审批授权、Core 进程连接生命周期、会话关闭容错、对话压缩正确性、Agent 服务工具批次契约、ACP 审批内存泄漏与 Renderer 渲染健壮性等多个面上，会导致 `stop()` 永久挂起、孤立运行任务、授权绕过、连接/进程泄漏、过期历史撑爆上下文、模型 API 契约破坏、缓慢内存泄漏与 UI 崩溃。H-10/H-16 经核查为既有正确行为，仅补充注释澄清。这些问题彼此独立但都影响运行时可靠性与安全边界，需统一收敛。

## What Changes

- 进程管理：`core-process.ts` 的 `stop()` 在 SIGTERM 后增加 SIGKILL 升级定时器，子进程忽略 SIGTERM 或事件循环卡死时强制终止，避免永久挂起（C-1）。
- Agent 协调器：`createAgentTurn` 默认 `reasoningEffort` 改用模型配置的 `defaultReasoningEffort`；`approve` 在 epoch 不匹配时不再提前清空 `pendingApproval`，保证 `#finish` 正确判断 `hadPendingApproval`；`start` 在 task 创建后、state 入表前的抛错路径回滚已持久化的 running task。
- Agent 协调器兜底：`#syncTask` 对终态非法状态转换用 try-catch 捕获，保留终态并避免 unhandled rejection（C-2）。
- 审批授权：`matchesApprovalGrant` 增加可选 `now` 参数并在 `expiresAt` 过期时拒绝匹配（H-2）；`ApprovalAwareGateway` 在工具调用失败路径清空 grant，防止相同命令被静默放行（H-5）。
- Core 请求路由：`closeAll` 用 try-catch 隔离 agent 关闭与 session 关闭，确保 agent 关闭失败不阻断 session PTY 关闭。
- Core 进程监督：`requestExit('terminate_all')` 用 try-finally 保证 `launcher.stop()` 必执行；`#connectInternal` 在 handshake 抛异常时关闭连接；区分“已有 Core”与“自启 Core”两条路径，后者 handshake 失败时停止 launcher。
- 对话压缩器：当已有摘要仍超阈值且无新条目可压缩时，将已有摘要并入重新摘要，避免返回超限历史。
- Agent 服务：审批恢复 checkpoint 的 `toolCallCount` 计入审批前已执行 call，避免低估绕过 `maxToolCalls`（H-12）；可恢复错误为批次剩余 call 生成占位 tool_result，保持模型 API 契约（H-13）。
- ACP 控制器：`respondApproval` 消费后、`#cancelPendingApprovals`/`#terminateOne` 终止时清理全局 `approvalRequests` Map，消除内存泄漏。
- 桌面应用：`PendingButton` 修复同步抛错逃逸导致的永久 busy 态（H-17）；`AllSessionsPopover` 会话过滤增加空值保护（H-18）。
- 会话状态：H-10 保持“shell 转 ready 自动标记环境 verified”的既有逻辑，仅改写注释说明机制来源。
- Renderer Markdown：确认 `MarkdownContent` 已使用 `react-markdown`（不渲染原始 HTML）且链接已强制 `rel="noreferrer" target="_blank"`，H-16 已被既有实现缓解；在 `markdown-content.tsx` 补充不可信来源约束注释。

## Capabilities

### New Capabilities

### Modified Capabilities
- `agent-execution`: 收紧 Agent Turn 默认推理强度来源、approve/cancel 状态一致性、start 失败回滚与对话压缩超限兜底的要求。
- `desktop-runtime-assurance`: 收紧 Core 连接握手失败与进程停止的资源释放要求。
- `terminal-sessions`: 收紧 closeAll 关闭流程容错要求。
- `acp-driver`: 收紧全局审批请求表的生命周期清理要求。
- `interaction-feedback`: 收紧不可信 Markdown 来源的渲染安全要求。

## Impact

- `packages/domain/src/agent/agent-conversation.ts`：`createAgentTurn` 默认 reasoningEffort 来源。
- `packages/application/src/agent/agent-coordinator.ts`：`approve`、`start` 失败回滚。
- `packages/application/src/agent/approval-aware-gateway.ts`：失败路径清空 grant。
- `packages/domain/src/approval/approval-grant.ts`：`expiresAt` 过期检查。
- `packages/application/src/router/core-request-router.ts`：`closeAll` 容错。
- `apps/desktop/src/main/core-supervisor.ts`：`requestExit`、`#connectInternal` 资源释放。
- `apps/desktop/src/main/core-process.ts`：SIGKILL 升级。
- `packages/agent-service/src/context/conversation-compactor.ts`：超限兜底。
- `packages/agent-service/src/runtime/agent-runtime.ts`：`toolCallCount` 基数与占位 tool_result。
- `apps/desktop/src/acp/acp-controller.ts`：`approvalRequests` 清理。
- `apps/desktop/src/renderer/feedback/pending-button.tsx`：Promise 链修复。
- `apps/desktop/src/renderer/sessions/all-sessions-popover.tsx`：空值保护。
- `packages/ui-platform/src/markdown/markdown-content.tsx`：不可信来源注释。
- `packages/domain/src/session/session-state.ts`：注释澄清（H-10，不改逻辑）。
- 无 IPC、协议或数据库 schema 变更；新增/补充对应单元测试。
