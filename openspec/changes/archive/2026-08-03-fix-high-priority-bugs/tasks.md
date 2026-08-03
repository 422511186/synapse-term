# Tasks

## 范围说明

- 实现范围（含 C/H 共 18 项代码修复 + 2 项注释澄清）：C-1、C-2、H-1~H-9、H-11~H-13、H-15、H-17、H-18；H-10、H-16 经核查为既有正确行为，仅补充注释澄清，不改逻辑。
- H-14（onItem 脱敏）由检修分支（codex/review-pr3）实现，未含于 PR head；并入 PR 时需同步勾选对应任务。

## H-1 reasoningEffort 默认值

- [x] 1.1 修改 `packages/domain/src/agent/agent-conversation.ts` 的 `createAgentTurn`，将 `input.reasoningEffort ?? (model === undefined ? undefined : 'low')` 改为 `input.reasoningEffort ?? model?.defaultReasoningEffort`
- [x] 1.2 在 `packages/domain/src/agent/agent-conversation.test.ts` 新增测试：模型声明 `defaultReasoningEffort: 'medium'` 且未传入 `reasoningEffort` 时，Turn 持有 `medium`
- [x] 1.3 运行 `pnpm --filter @synapse-term/domain test` 验证

## H-3 approve epoch 不匹配的 hadPendingApproval

- [x] 3.1 修改 `packages/application/src/agent/agent-coordinator.ts` 的 `approve`，删除 epoch 不匹配分支中的 `state.pendingApproval = undefined;`，让 `#finish` 统一清空
- [x] 3.2 在 `packages/application/src/agent/agent-coordinator.test.ts` 新增测试：approve 时 epoch 不匹配应触发 takeoverUser（shell 不再是 ready）
- [x] 3.3 运行 `pnpm --filter @synapse-term/application test` 验证

## H-4 start 失败回滚

- [x] 4.1 修改 `packages/application/src/agent/agent-coordinator.ts` 的 `start`，提取 `#buildAndStartAgentState` 并用 try-catch 包裹，catch 中回滚 task 为 `failed` 并持久化后重新抛出
- [x] 4.2 在 `packages/application/src/agent/agent-coordinator.test.ts` 新增测试：start 在 createAdapter 抛错时 task 应转为 `failed` 且不入 `activeTaskCount`
- [x] 4.3 运行 `pnpm --filter @synapse-term/application test` 验证

## H-6 closeAll 容错

- [x] 6.1 修改 `packages/application/src/router/core-request-router.ts` 的 `closeAll`，将 `closeAllIfConfigured()` 包入 try-catch，catch 中 console.error 记录但不中断
- [x] 6.2 已通过现有 closeAll 集成测试覆盖
- [x] 6.3 运行 `pnpm --filter @synapse-term/application test` 验证

## H-7 requestExit try-finally

- [x] 7.1 修改 `apps/desktop/src/main/core-supervisor.ts` 的 `requestExit('terminate_all')`，将 `core.shutdown` 请求与 `#closeConnection()`/`launcher.stop()` 用 try-finally 包裹
- [x] 7.2 运行 `pnpm --filter @synapse-term/desktop typecheck` 验证

## H-8 handshake 抛异常时关闭连接

- [x] 8.1 修改 `apps/desktop/src/main/core-supervisor.ts` 的 `#connectInternal`，将 `connection.handshake()` 用 try-catch 包裹，catch 中 `connection.close()` 后重新抛出
- [x] 8.2 运行 typecheck 验证

## H-9 自启 Core handshake 失败时停止 launcher

- [x] 9.1 修改 `apps/desktop/src/main/core-supervisor.ts` 的 `#connectInternal`，引入 `selfStarted` 标志；handshake 失败（`!ok` 或抛异常）且 `selfStarted` 时调用 `launcher.stop()`
- [x] 9.2 已通过 typecheck 验证；现有 core-supervisor 测试覆盖连接流程
- [x] 9.3 运行 `pnpm --filter @synapse-term/desktop test` 验证

## H-11 压缩器超限兜底

- [x] 11.1 修改 `packages/agent-service/src/context/conversation-compactor.ts`，`keptTokens` 初始值计入 `existingSummary` token 数；当 `compactedItems` 为空但仍超阈值时，强制把 `kept` 最早 turn 移入 `compactedItems` 并重新摘要
- [x] 11.2 已通过现有 compactor 测试覆盖
- [x] 11.3 运行 `pnpm --filter @synapse-term/agent-service test` 验证

## H-15 approvalRequests 清理

- [x] 15.1 修改 `apps/desktop/src/acp/acp-controller.ts` 的 `respondApproval`，先读取 request 再 `approvalRequests.delete(approvalId)`
- [x] 15.2 修改 `#cancelPendingApprovals`，循环中对每个 approvalId 执行 `approvalRequests.delete(approvalId)`
- [x] 15.3 已通过现有 acp-controller 测试覆盖
- [x] 15.4 运行 `pnpm --filter @synapse-term/desktop test` 验证

## H-16 Markdown 渲染安全确认

- [x] 16.1 核查 `packages/ui-platform/src/markdown/markdown-content.tsx` 已使用 `react-markdown` 且无 `dangerouslySetInnerHTML`；补充注释说明不可信来源约束
- [x] 16.2 已通过现有 MarkdownContent 测试覆盖
- [x] 16.3 运行 `pnpm --filter @synapse-term/ui-platform test` 验证

## C-1 core-process SIGKILL 升级

- [x] C-1.1 `stop()` 发送 SIGTERM 后启动 SIGKILL 升级定时器（阈值 = max(gracefulStopTimeoutMs, 1s)），子进程忽略 SIGTERM 或事件循环卡死时强制终止，避免 `stop()` 永久挂起
- [x] C-1.2 定时器在子进程 exit/error 后清理，`#child` 引用置空逻辑保持不变

## C-2 #syncTask 非法转换兜底

- [x] C-2.1 `#syncTask` 的 `scheduler.transition` 包入 try-catch，捕获后保留 current 终态并仅同步其他字段，避免 unhandled rejection 破坏 `#consumeRuntime`/idle 流程
- [x] C-2.2 在 `agent-coordinator.test.ts` 补充测试：cancel 后 runtime 回传 failed/running 旧状态时任务保持 cancelled

## H-2 approval-grant expiresAt 检查

- [x] H-2.1 `matchesApprovalGrant` 增加可选 `now` 参数（默认当前时间），`grant.expiresAt` 已过期时直接返回 false，防止过期授权复用
- [x] H-2.2 由检修分支补充 `approval-grant.test.ts` 过期用例（PR head 未含测试）

## H-5 工具失败路径清理 grant

- [x] H-5.1 `ApprovalAwareGateway.call` 在工具结果非 ok 时清空 `#grant`，防止相同命令被后续调用静默放行
- [x] H-5.2 通过现有 gateway/coordinator 相关测试回归（无独立测试文件）

## H-10 环境验证机制注释澄清

- [x] H-10.1 `transitionSessionShell` 保持“shell 转 ready 自动标记环境 verified”的既有逻辑（由 shell probe 流程保证），仅改写注释说明机制来源，不做逻辑修复

## H-12 toolCallCount 恢复基数

- [x] H-12.1 审批恢复 checkpoint 的 `toolCallCount` 改为 `toolCallCount + index`，计入本批次审批前已执行的 call，避免低估计数绕过 `maxToolCalls` 限制
- [x] H-12.2 由检修分支补充 `agent-runtime.test.ts` 用例（PR head 未含测试）

## H-13 缺失 tool_result 占位

- [x] H-13.1 可恢复错误（非 terminal_busy）与审批等待中断路径，为批次剩余 call 生成 `skipped_due_to_prior_failure` 占位 tool_result（`isError: true`），保持模型 API 契约
- [x] H-13.2 占位 item 同步通过 `onItem` 发射
- [x] H-13.3 由检修分支补全回滚/清理路径与 `agent-runtime.test.ts` 用例

## H-17 PendingButton 异常逃逸

- [x] H-17.1 `handleClick` 改用 `Promise.resolve().then(() => onClick())` 延迟求值，onClick 同步抛错进入 catch 链，不再永久卡在 busy 态

## H-18 AllSessionsPopover 空值保护

- [x] H-18.1 过滤字段统一 `(value ?? '')` 后调用 `toLocaleLowerCase()`，避免 undefined 字段导致崩溃

## 全局验证

- [x] Z-1 运行 `pnpm typecheck` 全部通过
- [x] Z-2 运行 `pnpm test` 全部通过（719 passed, 20 skipped）
- [x] Z-3 运行 `pnpm lint` 无问题
