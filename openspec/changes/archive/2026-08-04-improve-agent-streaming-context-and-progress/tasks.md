## 1. Protocol and Core Delta Events

- [x] 1.1 以失败的 `packages/protocol/src/core-api/core-api.test.ts` 与 `apps/desktop/src/main/desktop-core-bridge.test.ts` 定义 `agent.text_delta` 的 schema、`append/replace`、非空 delta 和 sequence 校验。
- [x] 1.2 实现 `packages/protocol` 的 `agentTextDeltaSchema` 与 Core service event，扩展 `AgentCoordinatorOptions`、`apps/core` 广播、Desktop bridge、IPC event channel 和 preload API；保持旧 timeline event 兼容。
- [x] 1.3 以失败的 Coordinator 测试验证 Provider 多个 delta 只通过 delta callback 发送新增片段，review replacement 的第一片使用 `replace`，空片段不发送。
- [x] 1.4 实现 Coordinator assistant stream sequence、append/replace 语义和终态 timeline 收敛，并更新相关 Core 集成测试。

## 2. Renderer Delta Aggregation

- [x] 2.1 以失败的 `packages/ui-platform/src/agent/agent-timeline-state.test.ts` 定义 ordered append、replace、sequence gap、stale event 和终态 history hydration 行为。
- [x] 2.2 实现 UI delta 类型与 reducer，扩展 Desktop API 监听 delta；sequence gap 时保留现状并触发对应 Session history refresh。
- [x] 2.3 以失败的 Renderer Agent panel 测试定义结构化 progress card 和流式期间有界更新行为。
- [x] 2.4 实现 App delta listener、progress timeline projection 和轻量/帧级 assistant 更新，不改变终态 Markdown 安全渲染。

## 3. Provider-backed Conversation Summarization

- [x] 3.1 以失败的 `conversation-compactor.test.ts` 定义异步 Provider summary success、Provider error/Tool Call/empty fallback、secret redaction、oversized summary rejection 和已有摘要 token 上界。
- [x] 3.2 实现 `ConversationCompactor` 的 summary callback、deterministic evidence fallback、实际 token fitting、最小预算 fail-closed 和 summary method 结果。
- [x] 3.3 以失败的 `agent-coordinator.test.ts` 定义 compaction 前无 Tool Provider summary request、独立输出预算、summary request 不计用户 Tool Call，以及摘要审计元数据。
- [x] 3.4 实现 Coordinator 的异步 compaction 生命周期：提前创建当前 Adapter，发起脱敏无 Tool summary，限制 timeout/cancellation，失败后继续 deterministic fallback，并仅持久化有界结果。

## 4. Structured Agent Progress

- [x] 4.1 以失败的 `agent-runtime.test.ts` 定义 planning、Tool step running/completed/failed、verifying review、approval checkpoint restore 和 cancellation terminal progress。
- [x] 4.2 实现 Runtime bounded progress snapshot、Tool step 状态转换和 approval checkpoint 恢复；不增加隐藏推理或新 Tool。
- [x] 4.3 以失败的 Coordinator/Renderer 测试定义稳定 progress timeline item、脱敏 label、终态 phase 和旧 timeline 兼容。
- [x] 4.4 实现 AgentCoordinator 的 progress 投影、protocol optional progress schema 与 Desktop progress card，确保 progress 不影响 Policy/Approval/Lease。

## 5. Verification

- [x] 5.1 运行 delta、compaction、runtime、Coordinator、protocol、bridge、UI 专项 Vitest，并修复回归。
- [x] 5.2 运行受影响 packages/apps 的 typecheck、lint 和构建，确认新 Core/IPC event 在所有入口都有 schema 校验。
- [x] 5.3 运行全量 Vitest、`pnpm verify`（若可用）与 `openspec validate improve-agent-streaming-context-and-progress --strict`，记录剩余环境限制。
