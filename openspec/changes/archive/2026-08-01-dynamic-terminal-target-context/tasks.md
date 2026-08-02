## 1. Environment model and probe contract

- [x] 1.1 先为 operatingSystem、环境摘要和旧记录默认值编写失败测试，再扩展 `packages/domain/src/session-state.ts` 与 `packages/protocol/src/domain-schemas.ts`，保持旧 Session 可读取为 `unknown`。
- [x] 1.2 为 Windows、Linux、macOS 和未知指纹编写 Shell Probe 解析失败测试，再实现固定明文 OS fingerprint marker、平台映射和严格 nonce 校验。
- [x] 1.3 让 `ShellProbe` 在匹配完成事件后以实际 dialect/platform/operatingSystem 调用 `SessionActor.verifyCurrentEnvironment`；Probe 失败保持 observation-only，并补齐 SSH/容器切换回归测试。

## 2. Agent context and environment-aware execution

- [x] 2.1 先添加 AgentCoordinator/ContextBuilder 回归测试，证明模型首轮请求前能看到当前 PTY 的 operatingSystem、dialect、platform 和 capability epoch。
- [x] 2.2 在 Agent 模型启动前完成环境准备，把有限的已验证环境摘要注入上下文，并更新 system prompt 要求模型区分 Windows Git Bash、Linux 和 macOS，不重复提交相同失败命令。
- [x] 2.3 确保资源刷新和命令 dispatch 只使用当前已验证环境；环境未知或 epoch 过期时返回结构化错误且不产生 Agent/资源副作用。

## 3. Approval lifecycle and cancellation

- [x] 3.1 先添加 approval epoch mismatch 的失败测试，再将 environment capability epoch 纳入 ApprovalGrant、ApprovalCandidate、PendingApproval、Gateway 和 Coordinator 校验。
- [x] 3.2 为“等待审批时取消”“Probe/Provider 运行中取消”“旧审批点击”和取消/审批竞态添加失败测试，修复 Coordinator 清理 pending approval、Runtime、lease 和 active task 的幂等状态流转。
- [x] 3.3 确保失败或不可用命令不会在没有新证据时自动重复同一 Tool Call；为 command-not-found/无进展结果补充 AgentRuntime 回归测试。

## 4. Desktop timeline and cancellation UX

- [x] 4.1 先添加 approval 与 tool 使用相同 toolCallId 时仍保持独立卡片的失败测试，再按稳定 event id 优先修复 `upsertTimelineEvent` 和 history/live 合并。
- [x] 4.2 让 completed、cancelled、expired、environment-invalidated 的 approval 卡片隐藏操作并从时间线独立卡片中隐藏；旧审批返回 `approval_invalid` 时刷新状态而不留下可点击的过期卡片。
- [x] 4.3 让取消按钮以当前 Session 的活动 Agent Task 为目标，并避免全屏错误遮罩阻断取消；添加 Desktop/E2E 回归覆盖等待审批后取消和旧审批报错后取消。

## 5. Regression verification

- [x] 5.1 运行变更涉及的 Core/Domain/Protocol/Desktop 定向测试，确认新增回归用例先红后绿且无既有失败扩大。
- [x] 5.2 运行 workspace lint、typecheck、完整测试和桌面构建，记录任何独立于本 change 的平台环境失败。
- [x] 5.3 使用当前分支构建产物进行一次实际 Agent/审批/取消冒烟验证，确认 Windows Git Bash 不再因 POSIX 方言生成 `free -h`，并确认任务取消最终显示 `cancelled`。
