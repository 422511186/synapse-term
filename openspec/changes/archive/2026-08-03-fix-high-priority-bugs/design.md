## Context

本变更修复 BUG_REPORT.md（共 194 项）中 2 个 Critical 与 16 个 High 级别缺陷，并对 H-10/H-16 做注释澄清（核查后确认既有行为正确）。缺陷分布在进程管理、Agent 协调器、审批授权、Core 进程监督、会话关闭、对话压缩、Agent 服务工具批次、ACP 与 Renderer 等多个独立模块，彼此无耦合，可分别修复与测试。设计遵循"最小改动、保留既有外部语义"原则，不引入新 IPC、协议或数据库 schema。

## Goals

- 消除孤立 running Task、连接/进程泄漏、超限上下文、审批表内存泄漏与潜在 XSS。
- 每个修复都有可独立验证的单元测试。
- 不改变现有公开 API 签名（`matchesApprovalGrant` 已在上一变更增加可选 `now` 参数，本变更不重复）。

## Decisions

### H-1 reasoningEffort 默认值
- **文件**: `packages/domain/src/agent/agent-conversation.ts:93`
- **决策**: 将 `input.reasoningEffort ?? (model === undefined ? undefined : 'low')` 改为 `input.reasoningEffort ?? model?.defaultReasoningEffort`。
- **理由**: `AgentModelSelection` 已声明 `defaultReasoningEffort`，`createAgentTurn` 应直接消费它。Coordinator 在 `start()` 第 171 行已正确解析 `reasoningEffort`，本修复补齐 `createAgentTurn` 的防御性默认值，覆盖其他潜在调用方。
- **校验**: `supportedReasoningEfforts` 校验仍由 Coordinator 在 `start()` 第 172 行执行；`createAgentTurn` 不重复校验，仅提供正确默认值。

### H-3 approve epoch 不匹配的 hadPendingApproval
- **文件**: `packages/application/src/agent/agent-coordinator.ts:467-472`
- **决策**: 删除第 468 行 `state.pendingApproval = undefined;`，让 `#finish`（第 651 行）统一清空。
- **理由**: `#finish` 通过 `hadPendingApproval = state.pendingApproval !== undefined` 决定是否强制 takeover。提前清空导致走"返回 Lease 给用户"分支，用户拿到指向过期环境的 Lease。`#emitApprovalTimeline` 使用局部变量 `pending`，不依赖 `state.pendingApproval`，删除该行安全。

### H-4 start 失败回滚
- **文件**: `packages/application/src/agent/agent-coordinator.ts:182-360`
- **决策**: 用 try-catch 包裹第 188 行（`scheduler.start`）到第 360 行（`states.set`）之间的逻辑，catch 块中执行 `scheduler.transition(running.id, 'failed')` + `saveAgentTask` 并重新抛出。
- **理由**: state 入表前抛错会让 `cancel` 找不到 state 而无法清理已持久化的 running task。回滚到 `failed` 保持 `activeTaskCount` 与数据库一致。
- **边界**: `running` 在 try 块内声明；catch 中需判空（理论上 `scheduler.start` 成功后 `running` 必有值，但防御性判空更安全）。

### H-6 closeAll 容错
- **文件**: `packages/application/src/router/core-request-router.ts:295-300`
- **决策**: 将 `await this.#agentHandler.closeAllIfConfigured();` 包入 try-catch，catch 中仅记录（console.error），不中断后续 session 关闭循环。

### H-7/H-8/H-9 core-supervisor 资源释放
- **文件**: `apps/desktop/src/main/core-supervisor.ts`
- **H-7**: `requestExit` 的 `core.shutdown` 请求与 `#closeConnection()`/`launcher.stop()` 用 try-finally 包裹。
- **H-8**: `#connectInternal` 中 `connection.handshake()` 调用用 try-catch 包裹，catch 中 `connection.close()` 后重新抛出。
- **H-9**: 在 `#connectInternal` 中用布尔标志 `selfStarted` 标记是否走了 `launcher.start()` 路径；handshake 失败（`!ok` 或抛异常）时，若 `selfStarted` 则调用 `launcher.stop()`。
- **理由**: 区分"复用已有 Core"与"自启 Core"两条路径，前者不应停止 launcher，后者必须停止。

### H-11 压缩器超限兜底
- **文件**: `packages/agent-service/src/context/conversation-compactor.ts:46-47`
- **决策**: 当 `compactedItems.length === 0`（即所有新 turn 都放入 kept，但总量仍超阈值）时，将 `existingSummary` 的内容并入 `summarizeItems` 重新摘要，并把 `kept` 中最早的 turn 移入 `compactedItems` 参与摘要，直到返回历史不超过阈值或无更多 turn 可压缩。
- **实现**: 在第 47 行 `if (compactedItems.length === 0)` 分支中，改为：若 `kept.length === 0`（无任何 turn），将已有摘要作为唯一内容产出新摘要并返回空历史 + 新 compaction；否则从 `kept` 头部取出 turn 移入 `compactedItems` 重新摘要，循环直到 `keptTokens + summaryTokens <= thresholdTokens` 或 `kept` 为空。
- **简化**: 实际实现采用更直接的策略——`keptTokens` 初始值计入 `existingSummary` 的 token 数，使 while 循环正确退出；当 `compactedItems` 仍为空但超限时，强制把 `kept` 最早的 turn 移入 `compactedItems` 并重新摘要。

### H-15 approvalRequests 清理
- **文件**: `apps/desktop/src/acp/acp-controller.ts`
- **决策**:
  - `respondApproval`（第 375 行）：在 `conversation.pendingApprovals.delete(approvalId)` 后增加 `approvalRequests.delete(approvalId)`。
  - `#cancelPendingApprovals`（第 603 行）：在循环中对每个 approvalId 执行 `approvalRequests.delete(approvalId)`。

### H-16 Markdown 渲染安全
- **文件**: `packages/ui-platform/src/markdown/markdown-content.tsx`
- **决策**: 经核查 `MarkdownContent` 已使用 `react-markdown` + `remarkGfm`，不使用 `dangerouslySetInnerHTML`，链接已强制 `rel="noreferrer" target="_blank"`。H-16 已被既有实现缓解。本变更仅补充注释说明不可信来源约束，不改动逻辑。
- **测试**: 新增测试验证 `<script>` 标签被转义、不写入全局对象。

### 范围补充（与实现对齐）

- **C-1**: `core-process.ts` `stop()` 增加 SIGKILL 升级定时器（阈值 `max(gracefulStopTimeoutMs, 1s)`），子进程忽略 SIGTERM 时强制终止。
- **C-2**: `agent-coordinator.ts` `#syncTask` 对终态非法转换 try-catch 兜底，保留 current 终态并同步其他字段。
- **H-2**: `approval-grant.ts` `matchesApprovalGrant` 增加可选 `now` 参数，`expiresAt` 过期时拒绝匹配。
- **H-5**: `approval-aware-gateway.ts` 工具失败路径清空 `#grant`，维持一次性审批语义。
- **H-10**: `session-state.ts` 保持“shell 转 ready 自动标记 verified”既有行为，仅注释澄清（由 shell probe 流程保证）。
- **H-12**: `agent-runtime.ts` 审批恢复 checkpoint 的 `toolCallCount` 计入审批前已执行 call。
- **H-13**: `agent-runtime.ts` 可恢复错误路径为剩余 call 生成 `skipped_due_to_prior_failure` 占位 tool_result。
- **H-17**: `pending-button.tsx` 用 `Promise.resolve().then(...)` 延迟求值 onClick，修复同步抛错逃逸。
- **H-18**: `all-sessions-popover.tsx` 过滤字段 `(value ?? '')` 空值保护。
- **H-14**: onItem 脱敏由检修分支（codex/review-pr3）实现，未含于 PR head。

## Risks

- **H-4 try-catch 范围**: 若 catch 块本身抛错（如 `scheduler.transition` 失败），会掩盖原始错误。通过在 catch 中先记录原始错误再尝试回滚缓解。
- **H-9 selfStarted 标志**: 若 `launcher.start()` 成功但 `#connectWithRetries` 失败，`selfStarted` 仍为 true，此时 launcher 已启动 Core 但连接失败——应停止 launcher。现有代码在 `#connectWithRetries` catch 中已设 `disconnected` 并抛出，外层 try-catch 需覆盖此路径。
- **H-11 压缩循环**: 极端情况下（单 turn token 数已超阈值）可能仍无法压到阈值以下；此时保持现有"返回最佳努力结果"语义，不再无限循环。

## Migration

无迁移影响。所有修复均为内部行为收紧，不改变公开 API 或持久化格式。
