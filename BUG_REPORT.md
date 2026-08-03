# Synapse-Term 项目 Bug 与潜在缺陷清单

> 本报告基于对 `packages/domain`、`packages/application`、`packages/agent-service`、`apps/desktop`（main / preload / mcp / acp / renderer）、`apps/core` 全部源文件的逐行审查，覆盖逻辑、边界、异常、并发、性能、安全六大维度。
>
> **统计概览**：共发现 **194** 个问题，其中 Critical 2 个、High 18 个、Medium 72 个、Low 102 个。

| 严重程度 | 数量 | 说明                                           |
| -------- | ---- | ---------------------------------------------- |
| Critical | 2    | 进程级崩溃 / unhandled rejection，破坏核心流程 |
| High     | 18   | 安全语义破坏、资源泄漏、状态机不可恢复         |
| Medium   | 56   | 边界条件、异常路径、性能浪费、UI 状态混乱      |
| Low      | 45   | 代码规范、防御纵深、可维护性风险               |

---

## 目录

- [一、Critical 级别问题](#一critical-级别问题)
- [二、High 级别问题](#二high-级别问题)
- [三、Medium 级别问题](#三medium-级别问题)
- [四、Low 级别问题](#四low-级别问题)
- [五、修复优先级建议](#五修复优先级建议)

---

## 一、Critical 级别问题

### C-1 `core-process.ts` — `stop()` 在子进程忽略 SIGTERM 时永久挂起（无 SIGKILL 升级）

- **文件**: `apps/desktop/src/main/core-process.ts`
- **行号**: 74-85
- **类别**: 异常处理 / 进程管理
- **问题描述**: `stop()` 在优雅等待超时后仅调用 `child.kill()`（默认发送 SIGTERM）。如果子进程忽略或无法处理 SIGTERM，`finish` 回调永远不会被触发，`stop()` 返回的 Promise 永久挂起。没有 SIGKILL 升级机制，也没有最终超时兜底。
- **根因分析**: 设计上假设 SIGTERM 一定能让子进程退出。对于 Core 进程来说，如果其事件循环卡死或在执行不可中断的同步操作，SIGTERM 会被排队但无法处理。
- **影响**: 应用退出时（`electron-main.ts:252` `requestExit('terminate_all')` → `launcher.stop()`）会永久挂起，导致应用无法正常退出。最终 Electron 进程被用户强杀后，Core 子进程变成孤儿进程（尤其在 Windows 上）。
- **修复方向**: 在 `child.kill()` 后增加定时器，超时后调用 `child.kill('SIGKILL')` 强制终止。

### C-2 `agent-coordinator.ts` — `#syncTask` 在 cancel 后被 runtime 失败结果触发非法状态转换，导致 unhandled rejection

- **文件**: `packages/application/src/agent/agent-coordinator.ts`
- **行号**: 596-639（`#consumeRuntime`）、731-740（`#syncTask`）
- **类别**: 异常处理 / 并发
- **问题描述**: 当用户调用 `cancel()` 时，`#finish` 会将 task 转换为 `cancelled` 终态并从 `#states` 中删除。但被 cancel 的 `runtime.run()` 可能 resolve 出 `{ status: 'failed', task: ... }`。随后 `#consumeRuntime` 执行 `state.task = this.#syncTask(state, result.task)`，`#syncTask` 发现 `current.status === 'cancelled'` 而 `next.status === 'failed'`，调用 `scheduler.transition(next.id, 'failed')`。
- **根因分析**: 根据 `packages/domain/src/agent/agent-task.ts:51`，`cancelled: []` 是终态，不允许任何转换；`scheduler.transition` 在转换非法时 `throw new Error(transition.error)`。`#syncTask` 没有 try-catch，抛出的错误会让 `#consumeRuntime` reject；而 `#track` 只用 `void run.finally(...)` 删除引用，并不捕获 rejection，最终变成 unhandled rejection。同时 `idle()` 的 `Promise.all` 也会因之 reject，破坏优雅关闭流程。
- **修复方向**: 在 `#syncTask` 中对 `scheduler.transition` 的失败做兜底（try-catch 后返回 `current`），或在 `#consumeRuntime` 调用 `#syncTask` 前判断 `#states.get(state.task.sessionId) !== state` 提前 return。

---

## 二、High 级别问题

### H-1 `agent-conversation.ts` — `createAgentTurn` 默认 reasoningEffort 硬编码为 'low'，忽略模型配置

- **文件**: `packages/domain/src/agent/agent-conversation.ts`
- **行号**: 93
- **类别**: 逻辑错误
- **问题描述**: `reasoningEffort: input.reasoningEffort ?? (model === undefined ? undefined : 'low')`。当提供了 `model` 且调用方未显式传入 `reasoningEffort` 时，默认值被硬编码为 `'low'`，完全忽略 `model.defaultReasoningEffort` 字段，且不检查 `'low'` 是否在 `model.supportedReasoningEfforts` 中。
- **根因分析**: `AgentModelSelection` 类型明确包含 `defaultReasoningEffort` 字段，但 `createAgentTurn` 绕过了这个精心设计的默认值机制。如果模型只支持 `['high', 'xhigh']`，则创建出的 AgentTurn 会持有一个不被模型支持的 `reasoningEffort: 'low'`，导致下游推理请求失败或行为异常。
- **修复方向**: 使用 `model.defaultReasoningEffort` 而非硬编码 `'low'`。

### H-2 `approval-grant.ts` — `matchesApprovalGrant` 不检查 `expiresAt` 过期时间

- **文件**: `packages/domain/src/approval/approval-grant.ts`
- **行号**: 44-69
- **类别**: 安全 / 逻辑错误
- **问题描述**: `ApprovalGrant` 接口定义了 `expiresAt?: string | undefined`，但 `matchesApprovalGrant` 函数在比对 grant 与 candidate 时，完全不检查 `expiresAt`。一个已过期的 grant 仍然可以成功匹配 candidate，导致过期授权被用于执行命令。
- **根因分析**: `matchesApprovalGrant` 是纯函数，没有 `now` 时间参数。过期检查的责任被隐式地留给了调用方，但接口设计暗示 `expiresAt` 是 grant 的固有属性，应在匹配时考虑。测试文件完全没有测试过期场景。
- **修复方向**: 增加 `now: () => string` 参数并在 grant 含 `expiresAt` 时校验未过期。

### H-3 `agent-coordinator.ts` — `#finish` 在 approve 的 epoch 不匹配分支中误判 `hadPendingApproval`

- **文件**: `packages/application/src/agent/agent-coordinator.ts`
- **行号**: 467-472、649-701
- **类别**: 逻辑错误
- **问题描述**: `approve` 在 environment epoch 不匹配时，先在第 468 行 `state.pendingApproval = undefined`，再调用 `#finish(state, 'cancelled')`。`#finish` 第 650 行 `const hadPendingApproval = state.pendingApproval !== undefined` 因此读到 `false`。
- **根因分析**: `hadPendingApproval` 用于决定 `mustInvalidateEnvironment`。当其为 `false` 且 `transactionToolCallIds.size === 0` 且 `snapshot.shell === 'ready'` 时，会走 `returnAgentLeaseToUser` 分支而非 `takeoverUser`。但此时 `capabilityEpoch` 已不匹配审批时的环境，用户拿到的 lease 指向一个过期环境，需要重新探测却没被强制 takeover。
- **修复方向**: 在 `approve` 中不要在 `#finish` 之前清空 `pendingApproval`，或给 `#finish` 增加显式 `hadPendingApproval` 入参。

### H-4 `agent-coordinator.ts` — `start` 在 task 创建后、state 入表前抛错，留下孤立 running task

- **文件**: `packages/application/src/agent/agent-coordinator.ts`
- **行号**: 182-360
- **类别**: 异常处理 / 资源泄漏
- **问题描述**: 第 188-189 行已 `scheduler.start` 并 `saveAgentTask(running)`，但后续多处可能抛错且没有回滚（如 turn 状态机非法、`saveAgentConversation` / `saveAgentTurn` / `saveModelItem` 抛错、`createAdapter` 抛错）。
- **根因分析**: 这些抛错点都发生在第 360 行 `this.#states.set(sessionId, state)` 之前，state 没入表，后续 `cancel(sessionId)` 找不到 state 直接 return，无法清理已持久化的 `running` task。task 永远停在 `running`，`activeTaskCount` 不准，且数据库中残留脏数据。
- **修复方向**: 用 try-catch 包裹 182-360 段，失败时 `scheduler.transition(task.id, 'failed')` 并清理已写入的数据。

### H-5 `approval-aware-gateway.ts` — 工具调用失败后不清理 grant，后续相同命令可被自动放行

- **文件**: `packages/application/src/agent/approval-aware-gateway.ts`
- **行号**: 51-55
- **类别**: 安全
- **问题描述**: `callWithContext` 中 `if (!result.ok) return result;` 提前返回，`this.#grant` 不被清空（清空逻辑在第 88 行，仅成功路径执行）。
- **根因分析**: 失败后 grant 保留在实例上，下次相同 `command` 字符串的工具调用会被 `TerminalToolGateway.call` 命中 grant 而自动放行，绕过审批。这违反"一次性审批"语义——用户审批了一次，但后续相同命令的调用被静默放行。
- **修复方向**: 在 `if (!result.ok)` 分支也清空 grant。

### H-6 `core-request-router.ts` — `closeAll` 在 agent 关闭失败时跳过 session 关闭

- **文件**: `packages/application/src/router/core-request-router.ts`
- **行号**: 295-300
- **类别**: 异常处理
- **问题描述**: `await this.#agentHandler.closeAllIfConfigured()` 若抛错，后续 `for` 循环不会执行，所有 session PTY 不会被关闭，`#onActivityChange` 也不触发。
- **根因分析**: 没有 try-catch 隔离 agent 关闭与 session 关闭。closeAll 是关闭流程的最后一环，一旦中途抛错，资源全部泄漏。
- **修复方向**: 把 agent 关闭用 try-catch 包起来（记录但不中断），确保 session 关闭一定执行。

### H-7 `core-supervisor.ts` — `requestExit('terminate_all')` 在 `core.shutdown` 请求失败时不停止 launcher

- **文件**: `apps/desktop/src/main/core-supervisor.ts`
- **行号**: 253-260
- **类别**: 异常处理 / 进程管理
- **问题描述**: `requestExit('terminate_all')` 先发送 `core.shutdown` 请求，若该请求抛出异常（如 Core 挂起后请求超时），则 `#closeConnection()` 和 `launcher.stop()` 均不会执行，错误直接向上传播。Core 子进程继续运行但无人管理。
- **根因分析**: 缺少 `try-finally` 保护。
- **修复方向**: 将 `launcher.stop()` 包在 `finally` 块中。

### H-8 `core-supervisor.ts` — `#connectInternal()` 在 `handshake()` 抛异常时不关闭连接，导致连接泄漏

- **文件**: `apps/desktop/src/main/core-supervisor.ts`
- **行号**: 143-167
- **类别**: 异常处理 / 资源泄漏
- **问题描述**: 当 `connector.connect()` 成功获取连接后，若 `connection.handshake()` 抛出异常（而非返回 `{ ok: false }`），异常直接传播出 `#connectInternal()`，`connection.close()` 从未被调用。socket 保持打开状态，文件描述符泄漏。
- **根因分析**: `handshake()` 可能抛异常的场景包括 `loadToken()` 抛出、socket 在握手期间断开等。这些路径缺少 `try-catch` 来确保 `connection.close()`。
- **修复方向**: 将 handshake 部分包在 `try-catch` 中，catch 块中调用 `connection.close()` 后重新抛出。

### H-9 `core-supervisor.ts` — `#connectInternal()` 在新启动 Core 后 handshake 失败时不停止 launcher

- **文件**: `apps/desktop/src/main/core-supervisor.ts`
- **行号**: 133-167
- **类别**: 进程管理 / 资源泄漏
- **问题描述**: 当 `connector.connect()` 失败后走 `launcher.start()` 路径启动 Core，随后若 handshake 返回 `{ ok: false }` 或抛异常，Core 进程已经启动但不会被停止。
- **根因分析**: handshake 失败分支只关闭了 connection，没有调用 `launcher.stop()`。对于"已有 Core 运行"的场景这是正确的，但对于"刚刚自己启动 Core"的场景就泄漏了。
- **修复方向**: 区分两种路径，后者在 handshake 失败时应调用 `launcher.stop()`。

### H-10 `session-state.ts` — `transitionSessionShell` 自动将环境标记为 verified（虚假指纹验证）

- **文件**: `packages/domain/src/session/session-state.ts`
- **行号**: 336-350
- **类别**: 安全 / 逻辑错误
- **问题描述**: 当 shell 状态转为 `ready` 时，函数自动将 `environment.verificationStatus` 设为 `'verified'`，并将 `source` 设为 `'fingerprint'`。但 shell ready 只表示 shell 探测完成，不等于环境指纹验证完成。`source: 'fingerprint'` 是一个虚假声明。
- **根因分析**: `verifyEnvironment` 是一个独立的、显式的验证函数，但 `transitionSessionShell` 在 shell ready 时绕过了这个显式验证流程。这会导致下游组件（如 `ApprovalGrant` 的 `environmentEpoch` 检查）基于虚假的验证状态做出安全决策。
- **修复方向**: 不在 `transitionSessionShell` 中自动标记 verified，或仅标记为 `probed` 等中间状态。

### H-11 `conversation-compactor.ts` — 已有摘要过大时压缩器返回超限历史

- **文件**: `packages/agent-service/src/context/conversation-compactor.ts`
- **行号**: 39-47
- **类别**: 逻辑错误
- **问题描述**: 当 `[existingSummary, exact]` 超过 `thresholdTokens` 时进入压缩流程。while 循环将最近的 turn 放入 `kept`，如果所有新 turn 的 token 总和 <= `targetTokens`，则所有 turn 都进入 `kept`，`compactedItems` 为空。第 47 行直接返回已有摘要 + 全部新条目，即与超限检查时完全相同的历史。
- **根因分析**: 压缩逻辑仅处理新条目的压缩，不处理已有摘要过大的情况；且 `keptTokens` 未计入 `existingSummary` 的 token 数。
- **影响**: 压缩器返回了一个仍然超过阈值的历史，可能直接导致模型 API 拒绝（上下文过长）。
- **修复方向**: 当 `compactedItems.length === 0` 但总量仍超阈值时，应将已有摘要和新条目合并重新摘要；或在 `keptTokens` 初始值中计入 `existingSummary` 的 token 数。

### H-12 `agent-runtime.ts` — 审批恢复后 `toolCallCount` 低估，可绕过 `maxToolCalls` 限制

- **文件**: `packages/agent-service/src/runtime/agent-runtime.ts`
- **行号**: 610-619（checkpoint 保存）、304-319（恢复）、445（限制检查）
- **类别**: 逻辑错误 / 安全
- **问题描述**: 在 `#executeCalls` 中，当某个 call 触发 `waiting_approval` 时，checkpoint 保存 `toolCallCount`（进入本批次前的值）和 `calls.slice(index)`。进入 `#executeCalls` 前，index 之前的 call 已经执行完毕，但它们的计数没有加到 `toolCallCount` 上。恢复时 `toolCallCount += checkpoint.calls.length` 只加了剩余 call 的数量，漏掉了审批前已执行的 call。
- **根因分析**: checkpoint 保存的 `toolCallCount` 未包含本批次中审批前已执行的 call 数量。
- **示例**: `toolCallCount=10`，批次 [A,B,C,D,E]，A、B 执行后 C 触发审批。checkpoint 保存 `toolCallCount=10, calls=[C,D,E]`。恢复后执行 C,D,E，`toolCallCount = 10+3 = 13`。但实际已执行 5 个新 call，正确值应为 15。少了 2（A、B）。
- **影响**: `maxToolCalls` 限制可被绕过。
- **修复方向**: checkpoint 应保存 `toolCallCount + index`，或在 `#executeCalls` 内部每执行一个 call 就递增 `toolCallCount`。

### H-13 `agent-runtime.ts` — 可恢复错误导致批次中剩余 tool call 缺失 tool_result

- **文件**: `packages/agent-service/src/runtime/agent-runtime.ts`
- **行号**: 555-583、589-607
- **类别**: 逻辑错误
- **问题描述**: `#run` 将批次中所有 call 的 `assistant_tool_call` item 推入 `items`。随后 `#executeCalls` 逐个执行。如果某个 call 返回可恢复错误（非 `terminal_busy`），`return { kind: 'continue' }` 直接返回，跳过后续 call。后续 call 的 `assistant_tool_call` 已在 items 中，但没有对应的 `tool_result`。
- **根因分析**: 批次执行中提前退出时，未为剩余 call 生成占位 `tool_result`。`removeOrphanToolResults` 只移除没有对应 `assistant_tool_call` 的 `tool_result`，不会移除没有对应 `tool_result` 的 `assistant_tool_call`。
- **影响**: 模型 API 收到 `assistant_tool_call` 但无对应 `tool_result`，违反大多数模型 provider 的 API 契约（OpenAI、Anthropic 等要求每个 tool_call 必须有对应的 tool result），导致 API 错误。
- **修复方向**: 在 `return { kind: 'continue' }` 之前，为剩余未执行的 call 生成 `tool_result` 并推入 items/toolResults。

### H-14 `agent-runtime.ts` — `onItem` 回调接收未脱敏的 tool 参数和结果

- **文件**: `packages/agent-service/src/runtime/agent-runtime.ts`
- **行号**: 469、479、536、563、605、633
- **类别**: 安全
- **问题描述**: `this.#options.onItem?.(structuredClone(item))` 推送的 item 中，`assistant_tool_call` 的 `argumentsJson` 是原始 JSON（可能包含文件内容、命令含密码等）；`tool_result` 的 `content` 是原始工具输出（可能包含终端输出中的密钥）。这些未脱敏的内容直接传给 `onItem` 回调。
- **根因分析**: 脱敏只在发给模型的 `fitModelItems` 路径上执行，UI 回调路径遗漏。如果 UI 层将 `onItem` 的内容渲染到界面或写入日志，密钥会泄露给用户或日志系统。
- **修复方向**: 在 `onItem` 调用前对 item 执行 `redactItem`。

### H-15 `acp-controller.ts` — 模块级 `approvalRequests` Map 永不清理（内存泄漏）

- **文件**: `apps/desktop/src/acp/acp-controller.ts`
- **行号**: 1089（声明）、712（写入）、375（读取但未删除）、603-617、543-555、572-599
- **类别**: 性能（内存泄漏）/ 逻辑
- **问题描述**: `const approvalRequests = new Map<string, AcpApprovalRequest>()` 是模块级全局可变状态。`#gateCommand` 在每次需人工审批时写入；但 `respondApproval` 只 `get` 不 `delete`，而 `#cancelPendingApprovals`、`#handleAgentExit`、`#terminateOne` 在终止会话/进程崩溃时只清理 `conversation.pendingApprovals`（每会话 Map），从不清理全局 `approvalRequests`。
- **根因分析**: 审批请求的"文案索引"被设计为与会话解耦的全局表，但缺少对应的终态清理路径。
- **影响**: 长期运行的桌面主进程，每次 ACP 人工审批累积一条永不释放的条目，属缓慢内存泄漏。
- **修复方向**: 在 `respondApproval` 成功消费后、以及 `#cancelPendingApprovals`/`#terminateOne` 中对每个 approvalId 执行 `approvalRequests.delete(approvalId)`。

### H-16 `runtime-timeline.tsx` — `MarkdownContent` 渲染外部来源的 assistant 文本（潜在 XSS）

- **文件**: `apps/desktop/src/renderer/agent-panel/runtime-timeline.tsx`
- **行号**: 79
- **类别**: 安全（XSS）
- **问题描述**: `event.text`（kind==='assistant'）来自内置 Agent 的 LLM 输出或 ACP 外部 Agent（opencode）的 `agent_message_chunk`。若 `MarkdownContent` 内部使用 `dangerouslySetInnerHTML` 且未对原始 HTML/markdown 做 sanitize，攻击者控制的外部 Agent 或被注入的 LLM 输出可执行任意脚本。`mock-api.ts:493` 故意在测试文案中植入 `<script>window.bad = true</script>`，强烈暗示此为已知测试点。
- **根因分析**: 渲染不可信富文本，依赖外部组件做净化。
- **修复方向**: 需先确认 `MarkdownContent` 实现。若已净化则降级为信息项；若未净化，应在传入前用 DOMPurify 等做 sanitize。

### H-17 `pending-button.tsx` — `onClick` 同步抛出导致按钮永久卡在 busy 态

- **文件**: `apps/desktop/src/renderer/feedback/pending-button.tsx`
- **行号**: 52-66
- **类别**: 异常（async/await 误用）
- **问题描述**: `void Promise.resolve(onClick()).then(...).catch(...)`。表达式求值顺序：先求值 `onClick()`，再传入 `Promise.resolve`。若 `onClick` 是普通函数或同步抛出的函数，异常在 `Promise.resolve` 调用之前就已抛出，`.catch` 链根本不会捕获。此时 `setInternalPhase('busy')` 已执行，但永远没有 `.then`（置 success）或 `.catch`（置 idle）来回退，按钮永久禁用。
- **根因分析**: `Promise.resolve(onClick())` 不能捕获同步抛出。
- **修复方向**: 改为 `Promise.resolve().then(() => onClick())` 或用 try/catch 包裹 `onClick()` 调用。

### H-18 `all-sessions-popover.tsx` — undefined 字段调 `toLocaleLowerCase` 崩溃

- **文件**: `apps/desktop/src/renderer/sessions/all-sessions-popover.tsx`
- **行号**: 23-28
- **类别**: 边界（null/undefined）
- **问题描述**: `[session.title, session.terminalType, session.pty, session.shell].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))`。若 `SessionSummary` 中任一字段为 `undefined`，`value.toLocaleLowerCase()` 抛 `TypeError`，整个 `AllSessionsPopover` 渲染崩溃。
- **根因分析**: 未对数组元素做空值保护。
- **影响**: 单条脏数据导致整个会话列表崩溃。
- **修复方向**: 改为 `(value ?? '').toLocaleLowerCase().includes(normalizedQuery)`。

---

## 三、Medium 级别问题

### Domain 层

| 编号 | 文件                              | 行号         | 类别        | 问题摘要                                                                                      |
| ---- | --------------------------------- | ------------ | ----------- | --------------------------------------------------------------------------------------------- |
| M-1  | `agent/agent-conversation.ts`     | 76-98        | 逻辑/边界   | `createAgentTurn` 不校验 reasoningEffort 是否在模型支持范围内                                 |
| M-2  | `agent/agent-conversation.ts`     | 204          | 逻辑/状态机 | `recoverable_error` 是终态，无法重试，与命名语义矛盾                                          |
| M-3  | `agent/agent-task.ts`             | 1-7, 31-37   | 逻辑/边界   | `createAgentTask` 不校验内置驱动者的 providerProfileId 必填约束                               |
| M-4  | `approval/approval-grant.ts`      | 40-42        | 逻辑/并发   | `createApprovalGrant` 直接返回 input，不进行拷贝，破坏不可变性                                |
| M-5  | `provider/model-configuration.ts` | 238-239      | 逻辑        | `updateModelConfiguration` 用 `JSON.stringify` 比较能力，属性顺序敏感                         |
| M-6  | `provider/provider-profile.ts`    | 22-46        | 边界        | `createProviderProfile`/`updateProviderProfile` 缺少输入验证（timeoutMs 可为 0/负/NaN）       |
| M-7  | `session/command-protocol.ts`     | 62-75        | 逻辑/边界   | `parseCompletionMarker` 在 nonce 包含 `__` 时解析失败                                         |
| M-8  | `session/command-transaction.ts`  | 12-23, 72-86 | 逻辑/状态机 | `CommandTransactionStatus` 缺少 `cancelled` 状态，无法取消未执行事务                          |
| M-9  | `session/command-transaction.ts`  | 82           | 逻辑/状态机 | `interaction_required` 是终态，用户完成交互后事务无法继续                                     |
| M-10 | `session/session-state.ts`        | 146-200      | 逻辑/并发   | `grantAgentLease` 允许 Agent 抢占 External 的 lease，与"三方互斥"注释矛盾                     |
| M-11 | `session/session-state.ts`        | 46-50        | 逻辑        | `verifyEnvironment` 将 `platform: 'unix'` 默认为 `operatingSystem: 'linux'`，macOS 被错误标记 |

### Application 层

| 编号 | 文件                                  | 行号             | 类别      | 问题摘要                                                                |
| ---- | ------------------------------------- | ---------------- | --------- | ----------------------------------------------------------------------- |
| M-12 | `router/handlers/model-handler.ts`    | 44-48, 152-153   | 异常      | `listModels` 单个 model 的 provider 缺失会让整个列表失败                |
| M-13 | `router/handlers/model-handler.ts`    | 127-133, 147-150 | 安全/合规 | `setEnabled`/`setDefault`/`importDiscoveredModels` 缺少审计             |
| M-14 | `router/handlers/provider-handler.ts` | 92-104           | 异常/资源 | `removeProvider` 删 secret 在删 provider 之后，失败会留孤立 secret      |
| M-15 | `router/handlers/external-handler.ts` | 294-314          | 资源泄漏  | `#pipelineFor` 替换缓存时旧 pipeline 不 dispose，泄漏 executor 与监听器 |
| M-16 | `router/core-request-router.ts`       | 291-293          | 逻辑      | `idle` 不等待 agent 任务，关闭流程语义不一致                            |
| M-17 | `router/handlers/session-handler.ts`  | 50-51, 308-324   | 内存泄漏  | `#titles`/`#terminalTypes` 在 PTY 退出时不清理                          |
| M-18 | `router/handlers/session-handler.ts`  | 289-306          | 安全      | `replayTerminal` 不校验 session 存在性，可能泄露已关闭会话历史          |

### Agent-Service 层

| 编号 | 文件                                | 行号             | 类别      | 问题摘要                                                                         |
| ---- | ----------------------------------- | ---------------- | --------- | -------------------------------------------------------------------------------- |
| M-19 | `context/context-budget.ts`         | 22               | 边界/逻辑 | `compactThresholdPercent` 缺少范围校验（0/负/>100 都有问题）                     |
| M-20 | `context/context-budget.ts`         | 23               | 逻辑      | `compactTargetTokens` 硬编码 60%，与可配置阈值比例无联动约束                     |
| M-21 | `context/context-builder.ts`        | 288-357          | 边界/逻辑 | 受保护的 `assistant_tool_call` 无法被截断，导致拟合失败                          |
| M-22 | `context/context-builder.ts`        | 233-240          | 性能      | `fitItems` 第一个 while 循环 O(n²) 性能问题                                      |
| M-23 | `context/context-builder.ts`        | 228              | 性能      | `structuredClone` 深拷贝整个 items 数组，O(n²) 累计开销                          |
| M-24 | `context/conversation-compactor.ts` | 38-45            | 逻辑/边界 | `keptTokens` 未计入已有摘要的 token 数，target 判断不准确                        |
| M-25 | `context/conversation-compactor.ts` | 72-80, 48        | 逻辑      | `groupByTurn` 假设 items 已按 sequence 排序，未排序时 throughSequence 错误       |
| M-26 | `context/conversation-compactor.ts` | 63-66            | 安全      | `kept` 中的条目未经脱敏处理，密钥可能泄露给模型                                  |
| M-27 | `runtime/agent-runtime.ts`          | 250-258, 331-333 | 逻辑/并发 | `cancel()`/`disconnectUi()` 在 `waiting_approval` 暂停状态下不生效               |
| M-28 | `runtime/agent-runtime.ts`          | 460-464          | 逻辑      | Tool 用途的 `usage` 和 `turn_completed` 事件在 deferred 模式下丢失               |
| M-29 | `runtime/agent-runtime.ts`          | 401-419          | 逻辑      | completion review 中模型返回 tool call 时，review 计数被消耗但未产出最终答案     |
| M-30 | `runtime/agent-runtime.ts`          | 674-685          | 性能/逻辑 | `#recordNoProgress` 将完整 result 序列化到签名中，性能差且易失效                 |
| M-31 | `runtime/agent-runtime.ts`          | 469, 362, 691    | 异常处理  | `onItem`/`onModelEvent`/`onTaskChange` 回调异常未捕获，可导致整个 agent run 失败 |
| M-32 | `runtime/agent-runtime.ts`          | 291-293          | 异常处理  | `contextBuilder.build()` 抛出异常时 task 状态未更新                              |
| M-33 | `runtime/agent-runtime.ts`          | 576-579          | 逻辑      | `terminal_busy` 的 continue 与其他可恢复错误的 `return continue` 语义不一致      |
| M-34 | 跨文件                              | 多处             | 性能      | `structuredClone` 大量使用导致性能瓶颈（O(n²) 累计）                             |
| M-35 | 跨文件                              | -                | 安全      | SecretRedactor 默认检测器覆盖面不足（不覆盖 AWS Key、JWT、GitHub Token 等）      |

### Desktop Main / Preload

| 编号 | 文件                                 | 行号    | 类别            | 问题摘要                                                          |
| ---- | ------------------------------------ | ------- | --------------- | ----------------------------------------------------------------- |
| M-36 | `core-process.ts`                    | 28-59   | 并发/进程       | `start()` 并发调用竞态条件，可产生孤儿进程                        |
| M-37 | `named-pipe-core-connector.ts`       | 61-79   | 异常/边界       | `connect()` 无连接超时，可永久挂起                                |
| M-38 | `electron-main.ts`                   | 248-269 | 异常/进程       | `before-quit` 清理链可永久挂起，无整体超时兜底                    |
| M-39 | `desktop-core-bridge.ts`             | 113-118 | 安全/逻辑       | `agent:start` 的 options 展开可覆盖已验证的 `sessionId` 和 `goal` |
| M-40 | `preload-api.ts`/`mcp-controller.ts` | 128, 86 | 安全            | MCP Bearer token 通过 `mcp:get-status` 暴露给渲染进程             |
| M-41 | `user-data-migration.ts`             | 89-113  | 异常/数据完整性 | 迁移非原子操作，部分失败可导致数据不一致                          |
| M-42 | `core-supervisor.ts`                 | 211-217 | 异常            | `request()` 重试路径中 `#closeConnection()` 抛异常会掩盖原始错误  |

### Desktop MCP

| 编号 | 文件                     | 行号             | 类别             | 问题摘要                                                               |
| ---- | ------------------------ | ---------------- | ---------------- | ---------------------------------------------------------------------- |
| M-43 | `mcp-tools.ts`           | 117-129          | 异常/安全        | `parseCoreRequest` 在 try-catch 外，验证失败导致未处理异常和信息泄露   |
| M-44 | `embedded-mcp-server.ts` | 123-147, 189-216 | 性能（内存泄漏） | 会话创建失败时 transport/server 资源泄漏                               |
| M-45 | `mcp-controller.ts`      | 95-109           | 异常/逻辑        | `boot` Promise 失败后控制器永久锁死，无恢复路径                        |
| M-46 | `embedded-mcp-server.ts` | 91-104           | 异常             | HTTP 服务器 `listen` 成功后无持久 `error` 事件监听器，可能导致进程崩溃 |
| M-47 | `embedded-mcp-server.ts` | 116-119          | 异常/性能        | `stop()` 中会话清理无超时保护，可能无限阻塞                            |

### Desktop ACP / Renderer

| 编号 | 文件                                                              | 行号           | 类别                       | 问题摘要                                                                     |
| ---- | ----------------------------------------------------------------- | -------------- | -------------------------- | ---------------------------------------------------------------------------- |
| M-48 | `acp-controller.ts`                                               | 481            | 边界/异常                  | `agent.child.stdin!` 非空断言对注入 spawner 不安全                           |
| M-49 | `acp-controller.ts`                                               | 658-665        | 逻辑/安全                  | `#handleRequestPermission` 对无 command 的平台工具一律 `allow_once`          |
| M-50 | `acp-history.ts`                                                  | 63-64          | 边界/逻辑                  | `mergeAcpHistoryIntoTimeline` 用文本相等去重，对流式/重复文本不稳健          |
| M-51 | `tool-timeline-card.tsx`                                          | 76             | 性能                       | 大型工具返回值无截断直接 `<pre>` 渲染，DOM 节点爆炸                          |
| M-52 | `confirm-dialog.tsx`/`model-settings.tsx`/`provider-settings.tsx` | -              | 异常/UI 状态               | 删除失败仍显"成功"态（`PendingButton` 与错误处理策略不匹配）                 |
| M-53 | `new-session-modal.tsx`                                           | 28-32          | 并发（useEffect 依赖错误） | `availableShells` 每 render 新数组，effect 每帧运行                          |
| M-54 | `new-session-modal.tsx`                                           | 34-47          | 逻辑（UI 状态）            | `create` 成功路径不重置 `creating`，依赖父组件关闭弹窗                       |
| M-55 | `model-edit-modal.tsx`                                            | 237-258, 43-54 | 边界/逻辑                  | `Number()` 对非法输入产生 NaN，校验被 NaN 比较绕过                           |
| M-56 | `model-settings.tsx`                                              | 32-50          | 并发（stale closure）      | `toggleEnabled` 用闭包 models 而非函数式 setState，乐观更新易被覆盖          |
| M-57 | `audit-format.ts`                                                 | 3-7            | 异常                       | `Intl.DateTimeFormat.format` 对 Invalid Date 抛 RangeError，整个面板白屏     |
| M-58 | `app.tsx`                                                         | 714-748        | 并发（状态更新反模式）     | `closeSession` 在 `setSessions` updater 内嵌套调用其他 setState              |
| M-59 | `app.tsx`                                                         | 591-629        | 并发（竞态）               | `submitGoal` 的 `activeTurn` 守卫存在双提交竞态                              |
| M-60 | `app.tsx`                                                         | 412-432        | 性能                       | 每个 timeline 事件触发一次 `refreshAgentHistory`/`refreshAcpHistory`，无节流 |

### Core 应用

| 编号 | 文件                  | 行号    | 类别                  | 问题摘要                                                                            |
| ---- | --------------------- | ------- | --------------------- | ----------------------------------------------------------------------------------- |
| M-61 | `core-application.ts` | 290-302 | 异常/资源泄漏         | `close()` 清理链非容错，前序抛错导致后续资源全部泄漏                                |
| M-62 | `core-application.ts` | 201-216 | 逻辑/异常             | `terminate_all` 关停返回伪成功并静默吞掉关停错误                                    |
| M-63 | `main.ts`             | 61-65   | 异常                  | `application.start()` 失败时不调用 `application.close()`，资源非优雅释放            |
| M-64 | `main.ts`             | 34-45   | 并发/信号             | 信号处理用 `process.once`，第二次信号绕过清理                                       |
| M-65 | `main.ts`             | 34-59   | 异常                  | 信号回调 `void close().then(...)` 在 `close()` reject 时产生未处理 rejection        |
| M-66 | `main.ts`             | 7-18    | 并发/异常             | `forceTerminateOwnProcessTree` 在 win32 上 `spawn` 失败与 `process.exit` 时序问题   |
| M-67 | `main-options.ts`     | 23-27   | 边界                  | `idleExitDelayMs` 允许 0，启动即空闲会立即调度退出                                  |
| M-68 | `main-options.ts`     | 19-20   | 安全（路径/命名注入） | `appId`、`username` 未做字符校验                                                    |
| M-69 | `maintenance-cli.ts`  | 21-25   | 异常                  | `verify-backup` 分支无 try-catch，`verifyDatabaseBackup` 可抛错导致未处理 rejection |
| M-70 | `maintenance-cli.ts`  | 69-71   | 边界/逻辑             | `isCoreRunning` 对 pid 无效时返回 `true`，可能永久阻断恢复                          |
| M-71 | `maintenance-cli.ts`  | 26-45   | 安全（路径遍历）      | `restore-backup` 未校验 `databasePath`/`manifestPath`，存在路径越界风险             |
| M-72 | `maintenance-main.ts` | 3-7     | 异常                  | 顶层 `await` 无 try-catch，`runCoreMaintenance` 抛错即未处理 rejection              |

---

## 四、Low 级别问题

### Domain 层

| 编号 | 文件                              | 行号       | 类别               | 问题摘要                                                      |
| ---- | --------------------------------- | ---------- | ------------------ | ------------------------------------------------------------- |
| L-1  | `agent/agent-conversation.ts`     | 113, 162   | 异常/兼容性        | `structuredClone` 在旧运行时不可用                            |
| L-2  | `agent/agent-driver.ts`           | 57, 64     | 逻辑（文档不一致） | `createBuiltinDriverInfo` 注释与实现矛盾                      |
| L-3  | `agent/agent-driver.ts`           | 58-67      | 逻辑/并发          | `createBuiltinDriverInfo` 返回的对象和嵌套数组未冻结          |
| L-4  | `agent/external-caller.ts`        | 16-25      | 边界               | `createExternalCaller` 不校验 id 非空                         |
| L-5  | `agent/tool-provider.ts`          | 44-46      | 性能               | `findTool` 线性搜索，大规模工具列表性能不佳                   |
| L-6  | `provider/model-configuration.ts` | 83, 91, 96 | 逻辑（死代码）     | `defaultReasoningEffort === undefined` 检查为死代码           |
| L-7  | `provider/model-configuration.ts` | 256        | 代码规范           | `import type` 语句位于文件最后一行                            |
| L-8  | `session/command-protocol.ts`     | 27, 64     | 逻辑               | `parseCompletionFrame`/`parseCompletionMarker` 只解析第一个帧 |
| L-9  | `session/command-transaction.ts`  | 83         | 逻辑/状态机        | `interrupted` 是终态，无法恢复执行                            |
| L-10 | `session/session-state.ts`        | 345        | 异常/可测试性      | `transitionSessionShell` 直接用 `new Date()` 而非注入时间     |
| L-11 | `session/session-state.ts`        | 64-73      | 逻辑               | `invalidateEnvironment` 保留 `source` 字段，可能误导下游      |
| L-12 | `session/session-state.ts`        | 212-285    | 逻辑/设计一致性    | `releaseAgentLease` 将 owner 设为 `'none'` 而非 `'user'`      |

### Application 层

| 编号 | 文件                                  | 行号             | 类别 | 问题摘要                                                                  |
| ---- | ------------------------------------- | ---------------- | ---- | ------------------------------------------------------------------------- |
| L-13 | `agent/agent-coordinator.ts`          | 190-192, 425-427 | 性能 | `start`/`resetConversation` 用 `[...].reverse().find()` 选择 conversation |
| L-14 | `agent/agent-coordinator.ts`          | 501-504          | 异常 | `approve` 中 `#transitionTurn` 在 setGrant 之后抛错会留下不一致状态       |
| L-15 | `router/handlers/provider-handler.ts` | 34-48            | 性能 | `listProviders` 对每个 profile 单独 `secrets.get`，N 次 IO                |
| L-16 | `router/handlers/provider-handler.ts` | 83               | 边界 | `saveProvider` 把空字符串 apiKey 当作有效凭据写入                         |
| L-17 | `router/handlers/external-handler.ts` | 249-253          | 并发 | `classifyCommand` 存在 TOCTOU：`#session` 校验后再次 `get`                |
| L-18 | `router/handlers/session-handler.ts`  | 210, 213-263     | 异常 | `#runShareProbe` 是 fire-and-forget，grant 抛错会变成 unhandled rejection |
| L-19 | `router/handlers/session-handler.ts`  | 111-123          | 异常 | `createSession` 在 `#save` 失败时不清理 `#titles`/`#terminalTypes`        |
| L-20 | `router/core-request-router.ts`       | 148              | 安全 | `handle` 完全忽略 `connectionId`，无法做连接级资源隔离                    |
| L-21 | `agent/agent-coordinator.ts`          | 544-546          | 异常 | `idle` 在某个 run reject 时会让 `Promise.all` 立即 reject                 |
| L-22 | `agent/agent-coordinator.ts`          | 548-551          | 异常 | `closeAll` 顺序 cancel，单个 cancel 抛错会中断后续                        |

### Agent-Service 层

| 编号 | 文件                                | 行号               | 类别      | 问题摘要                                                               |
| ---- | ----------------------------------- | ------------------ | --------- | ---------------------------------------------------------------------- |
| L-23 | `context/context-budget.ts`         | 16-19              | 边界      | `contextWindowTokens`/`maxOutputTokens` 关系缺少前置校验               |
| L-24 | `context/context-builder.ts`        | 371-379            | 逻辑      | `truncateWithMarker` 在短字符串上产生内容重叠                          |
| L-25 | `context/context-builder.ts`        | 174                | 逻辑      | `lastUserContentLength` 基于未脱敏原始数据                             |
| L-26 | `context/context-builder.ts`        | 133                | 边界      | `build` 方法未处理空 goal                                              |
| L-27 | `context/conversation-compactor.ts` | 101                | 逻辑      | `summarizeItems` 的 `slice(-6_000)` 从末尾截取，丢弃旧摘要             |
| L-28 | `context/token-estimator.ts`        | 12                 | 边界/性能 | `estimateTextTokens` 对 astral 字符（emoji）的 token 估算偏高          |
| L-29 | `context/token-estimator.ts`        | 6-14               | 性能      | 逐字符正则匹配性能开销                                                 |
| L-30 | `runtime/agent-runtime.ts`          | 769                | 逻辑/性能 | `stableJson` 使用 `localeCompare` 排序，非确定性                       |
| L-31 | `runtime/agent-runtime.ts`          | 327, 376, 399, 500 | 逻辑      | turn 计数在不同失败路径上不一致                                        |
| L-32 | `runtime/agent-runtime.ts`          | 187, 246           | 并发      | `#controller` 在首次 run 后永不重置，resume 依赖 controller 未被 abort |
| L-33 | `runtime/agent-runtime.ts`          | 747-751            | 逻辑      | `isCommandUnavailableResult` 未覆盖 Windows cmd.exe 的命令未找到消息   |
| L-34 | `tools/tool-call-assembler.ts`      | 21-39              | 异常      | `accept` 对异常事件直接 throw，导致整个 agent run 失败                 |
| L-35 | `tools/tool-call-assembler.ts`      | -                  | 逻辑      | 每个 turn 新建 assembler，跨 turn 的未完成 tool call 状态丢失          |
| L-36 | `tools/tool-call-assembler.ts`      | 45-47              | 逻辑      | `reset()` 方法存在但从未被调用（死代码）                               |

### Desktop Main / Preload

| 编号 | 文件                           | 行号    | 类别          | 问题摘要                                                                   |
| ---- | ------------------------------ | ------- | ------------- | -------------------------------------------------------------------------- |
| L-37 | `core-supervisor.ts`           | 128-141 | 状态一致性    | `#connectInternal()` 在 `launcher.start()` 抛异常后状态残留为 `'starting'` |
| L-38 | `named-pipe-core-connector.ts` | 249     | 性能          | socket 写入无背压处理                                                      |
| L-39 | `electron-main.ts`             | 109-121 | 边界/输入验证 | ACP IPC 处理器用 `String()` 转换参数，undefined 变为 "undefined"           |
| L-40 | `electron-main.ts`             | 155-186 | 配置/进程     | `resolveCoreLaunch` 未配置 `gracefulStopTimeoutMs`                         |
| L-41 | `user-data-migration.ts`       | 55-64   | 边界          | `backupTargetDatabase` 的 rename 在极端时间戳冲突时失败                    |
| L-42 | `electron-main.ts`             | 219     | 性能          | `sessions:environment` 每次调用都重新实例化 `ShellLocator`                 |
| L-43 | `electron-window.ts`           | 53-58   | 安全/防御纵深 | `webPreferences` 未显式设置 `webSecurity` 和 `allowRunningInsecureContent` |
| L-44 | `desktop-core-bridge.ts`       | 24-28   | 逻辑          | `inheritedEnvironment` 在 bridge 创建时快照，后续 `process.env` 变更不生效 |

### Desktop MCP

| 编号 | 文件                     | 行号        | 类别             | 问题摘要                                                  |
| ---- | ------------------------ | ----------- | ---------------- | --------------------------------------------------------- |
| L-45 | `embedded-mcp-server.ts` | 253-281     | 性能（内存泄漏） | `readJsonBody` 不移除事件监听器                           |
| L-46 | `embedded-mcp-server.ts` | 107-120     | 逻辑             | `stop()` 先关闭 HTTP 连接再关闭会话，顺序不理想           |
| L-47 | `mcp-tools.ts`           | 99-102      | 异常/边界        | `formatResult` 不处理循环引用                             |
| L-48 | `embedded-mcp-server.ts` | 51, 191-194 | 性能/安全        | 无并发会话数量限制，授权调用者可耗尽内存                  |
| L-49 | `mcp-tools.ts`           | 26-30, 119  | 安全/逻辑        | `MCP_CALLER` 为共享可变对象引用，可能被意外修改           |
| L-50 | `mcp-controller.ts`      | 146-151     | 并发             | `dispose()` 未通过 `mutate` 串行化，与并发变更存在竞态    |
| L-51 | `mcp-settings.ts`        | 86-87       | 安全             | `sanitizeMcpSettings` 不校验 token 强度，弱 token 被接受  |
| L-52 | `mcp-settings.ts`        | 69-74       | 并发/数据完整性  | `save` 写入固定临时文件路径，并发写可能互相覆盖           |
| L-53 | `embedded-mcp-server.ts` | 249         | 安全             | `isAuthorized` 中 token 长度比较非恒定时间                |
| L-54 | `embedded-mcp-server.ts` | 224, 231    | 逻辑             | `closeHttpServerBounded` 重复调用 `closeAllConnections()` |
| L-55 | `mcp-controller.ts`      | 65-71       | 异常/逻辑        | `refreshServer` 中 `store.save` 失败后端口状态不一致      |
| L-56 | `embedded-mcp-server.ts` | 163-166     | 逻辑（协议合规） | 非 POST/GET 方法返回 405 但未设置 `Allow` 头              |

### Desktop ACP / Renderer

| 编号 | 文件                         | 行号             | 类别                   | 问题摘要                                                                 |
| ---- | ---------------------------- | ---------------- | ---------------------- | ------------------------------------------------------------------------ |
| L-57 | `acp-controller.ts`          | 337-338          | 异常                   | `#runPrompt` 的外层 `void run.catch(() => undefined)` 吞掉所有 rejection |
| L-58 | `acp-controller.ts`          | 551-555, 577-579 | 逻辑                   | `#handleAgentExit` 与 `#cancelPendingApprovals` 终态收尾逻辑重复         |
| L-59 | `acp-controller.ts`          | 1020-1030        | 逻辑                   | `#toStatus` 的 `running` 判定取第一个未退出会话，多会话场景下不全面      |
| L-60 | `acp-settings.ts`            | 54-59            | 异常/边界              | `save` 写文件非原子，tmp 与 rename 之间崩溃则残留 .tmp                   |
| L-61 | `acp-settings.ts`            | 70               | 安全（逻辑）           | `sanitizeAcpSettings` 对 `enabled` 只接受严格 `true`                     |
| L-62 | `acp-settings-view.tsx`      | 41               | 并发（useEffect 依赖） | 依赖 `toast`，若引用不稳定会反复重订阅                                   |
| L-63 | `acp-settings-view.tsx`      | 143-156          | 逻辑（UI 状态）        | 切换审批模式按钮无 transition 态                                         |
| L-64 | `acp-history.ts`             | 42               | 边界                   | `occurredAt` 回退 `new Date(0).toISOString()` 不符合预期                 |
| L-65 | `running-status-bar.tsx`     | 24-32            | 性能                   | `startedAt` 变化与 interval 可能瞬时双更                                 |
| L-66 | `runtime-timeline.tsx`       | 130, 141         | 异常                   | `onApprove`/`onTakeOver` 的 `.finally` 未接 `.catch`                     |
| L-67 | `runtime-timeline.tsx`       | 115-117          | 逻辑（UI 状态）        | `environment_invalidated` 状态显示"已接管"，语义不准                     |
| L-68 | `timeline-utils.ts`          | 16-20            | 逻辑                   | `parseToolCallSummary` 同时存在 command 和 arguments 时互斥化            |
| L-69 | `pending-button.tsx`         | 49-50            | 逻辑（UI 状态）        | 受控 `pending` 与内部 phase 叠加产生竞态                                 |
| L-70 | `toast-store.ts`             | 94               | 逻辑                   | error/info 类型不自动消失，仅靠 `maxVisible` 挤出                        |
| L-71 | `toast-store.ts`             | 79               | 边界                   | `getSnapshot` 返回内部数组引用，外部 mutate 会污染状态                   |
| L-72 | `confirm-dialog.tsx`         | 整文件           | 无障碍                 | 模态无 ESC 关闭、无 focus trap、无 click-outside                         |
| L-73 | `all-sessions-popover.tsx`   | 63               | 异常                   | `onClose` fire-and-forget 无错误处理                                     |
| L-74 | `search-history-modal.tsx`   | 46-48            | 性能/逻辑              | 列表用数组索引 `key={i}` 作 React key                                    |
| L-75 | `inputs.ts`                  | 26-59            | 边界                   | `modelInput`/`providerInput` 共享引用（浅拷贝）                          |
| L-76 | `model-edit-modal.tsx`       | 96, 99           | 逻辑                   | `testModel` 成功路径 `onDraftSaved?.()` 被调用两次                       |
| L-77 | `model-list-ops.ts`          | 17-19            | 边界                   | `formatTestDuration` 对 NaN 输入返回 `"NaNs"`                            |
| L-78 | `model-settings.tsx`         | 237              | 逻辑                   | `pending={pendingId === deleteTarget?.id}` 在无删除目标时为 `true`       |
| L-79 | `provider-edit-modal.tsx`    | 40-45            | 安全                   | `new URL(draft.baseUrl)` 不校验协议（`javascript:`/`file:` 可通过）      |
| L-80 | `provider-edit-modal.tsx`    | 50-64            | 异常                   | `testConnection` 成功保存但 `discoverModels` 失败时状态混乱              |
| L-81 | `provider-edit-modal.tsx`    | 28, 163-170      | 安全（敏感信息）       | `apiKey` 以明文 state 持有，devtools 可读取                              |
| L-82 | `resource-monitor-panel.tsx` | 23-26, 94        | 边界                   | `memoryPercent` 在 `usedBytes` 为 NaN 时产生 `NaN%`                      |
| L-83 | `resource-monitor-panel.tsx` | 131-140          | 边界                   | `formatBytes` 对负数/NaN 不健壮                                          |
| L-84 | `panel-layout.ts`            | 22-24            | 边界                   | `clampAgentPanelWidth` 对 NaN workspaceWidth 返回 NaN                    |
| L-85 | `app.tsx`                    | 206-208, 507-516 | 性能                   | `activeTimeline` 每 render 新数组，导致滚动 effect 频繁触发              |
| L-86 | `app.tsx`                    | 221              | 并发                   | `activeSessionIdRef.current = activeSessionId` 在 render 体内写 ref      |
| L-87 | `app.tsx`                    | 391-401          | 性能                   | `useEffect [activeSession]`（对象引用）频繁触发                          |
| L-88 | `app.tsx`                    | 872-890          | 异常                   | `runPendingConfirm` 未 catch，异常时 `pendingConfirm` 不清空             |
| L-89 | `app.tsx`                    | 多处             | 逻辑（状态更新顺序）   | 多处 `setActiveSessionId` 路径可能互相覆盖                               |
| L-90 | `app.tsx`                    | 1409             | 安全                   | `TerminalView` 与 `api` 直接透传，IPC 调用未在本侧校验                   |
| L-91 | `renderer-main.tsx`          | 12               | 边界                   | `document.getElementById('root')!` 非空断言                              |
| L-92 | `mock-api.ts`                | 1062, 1075, 1097 | 安全（敏感信息）       | `mcp.status` 返回对象包含 `token` 明文                                   |

### Core 应用

| 编号  | 文件                  | 行号    | 类别             | 问题摘要                                                   |
| ----- | --------------------- | ------- | ---------------- | ---------------------------------------------------------- |
| L-93  | `core-application.ts` | 132-141 | 异常（错误吞没） | `upgradeState.update` 失败仅 console.error，无上层感知     |
| L-94  | `core-application.ts` | 286-288 | 逻辑             | `request()` 使用硬编码 connectionId `'local-test'`         |
| L-95  | `core-application.ts` | 222-228 | 性能             | `emitTerminalOutput` 每事件 `Buffer.from(..., 'utf8')`     |
| L-96  | `index.ts`            | 8-14    | 逻辑             | 多包 `export *` 存在命名冲突风险                           |
| L-97  | `main.ts`             | 36-57   | 逻辑             | `process.exitCode` 与 `process.exit` 冗余设置              |
| L-98  | `main-options.ts`     | 41      | 逻辑（参数解析） | `Number(value)` 解析过于宽松（接受十六进制、指数）         |
| L-99  | `main-options.ts`     | 42      | 边界             | `idleExitDelayMs` 上限未约束                               |
| L-100 | `maintenance-cli.ts`  | 72-78   | 边界             | `process.kill(pid, 0)` 受 PID 回收影响，存在误判           |
| L-101 | `maintenance-cli.ts`  | 32-39   | 并发             | `isCoreRunning` 与 `restoreDatabaseBackup` 之间存在 TOCTOU |
| L-102 | `maintenance-cli.ts`  | 59-69   | 逻辑             | INI 解析过于朴素，不处理重复键、注释、引号包裹             |

---

## 五、修复优先级建议

### 第一优先级（必须立即修复）

1. **C-1** `core-process.ts` `stop()` 永久挂起 — 添加 SIGKILL 升级
2. **C-2** `agent-coordinator.ts` `#syncTask` 非法状态转换 — 添加 try-catch 兜底
3. **H-2** `approval-grant.ts` 过期授权可被复用 — 添加 `expiresAt` 检查
4. **H-5** `approval-aware-gateway.ts` grant 失败后保留 — 失败路径也清空 grant
5. **H-10** `session-state.ts` 虚假环境验证 — 不自动标记 verified
6. **H-12** `agent-runtime.ts` `toolCallCount` 低估 — 修复 checkpoint 计数
7. **H-13** `agent-runtime.ts` 缺失 tool_result — 为剩余 call 生成占位 result
8. **H-14** `agent-runtime.ts` `onItem` 未脱敏 — 调用前 redact
9. **H-17** `pending-button.tsx` 同步抛出卡死 — 修复 Promise 链
10. **H-18** `all-sessions-popover.tsx` undefined 崩溃 — 添加空值保护

### 第二优先级（尽快修复）

11. **H-1** reasoningEffort 硬编码 'low'
12. **H-3 / H-4** agent-coordinator 状态一致性问题
13. **H-6** closeAll 中断
14. **H-7 / H-8 / H-9** core-supervisor 资源泄漏
15. **H-11** 压缩器返回超限历史
16. **H-15** approvalRequests 内存泄漏
17. **H-16** XSS 风险（需先确认 MarkdownContent 实现）

### 第三优先级（计划修复）

18. 所有 Medium 级别问题，按影响面和修复成本排序
19. M-43（parseCoreRequest 在 try-catch 外）、M-46（HTTP error 监听器）修复成本极低
20. M-57（Invalid Date 抛 RangeError）、M-55（NaN 绕过校验）影响用户体验

### 第四优先级（机会性修复）

21. 所有 Low 级别问题，可在重构相关模块时顺带修复

---

## 附：关键风险链分析

最危险的场景是以下问题形成的连锁反应：

1. 用户退出应用 → `electron-main.ts` 触发 `before-quit`
2. `supervisor.requestExit('terminate_all')` 发送 `core.shutdown` 请求
3. Core 进程挂起或忽略请求 → 超时后 reject（**M-38** 清理链在此等待）
4. `.catch()` 捕获后进入 `launcher.stop()`（**H-7** 保证了 stop 会被调用）
5. `launcher.stop()` 等待优雅退出 → 超时后发送 SIGTERM
6. Core 忽略 SIGTERM → `stop()` 永久挂起（**C-1**）
7. `before-quit` 清理链永久阻塞 → 应用无法退出（**M-38**）
8. 用户强杀 Electron → Core 子进程成为孤儿（**H-7** + **C-1**）

**建议**：在 `before-quit` 增加整体超时（如 10 秒），超时后强制 `app.exit(1)`，并在 `core-process.ts` 的 `stop()` 中添加 SIGKILL 升级（如 SIGTERM 后 5 秒未退出则 SIGKILL）。

---

## 六、后续跟进（2026-08-03）

### 终端会话自动断开（SSH/sftp 场景）

- **现象**: 用户反馈近两小时内频繁自动 SSH 断开，具体表现为终端会话在无操作时自行关闭。
- **审计结论**（仅记录，未修改代码）:
  - 09:47 本地时间 core 启动后约 10 秒，11 个旧会话集体以 `pty:failed` 关闭，符合 core 进程替换的典型特征（旧 core 的 PTY 子进程全部被杀）。
  - 13:33:37 sftp 会话关闭时 PTY 状态仍为 `running`；core 进程（pid 85139）自 09:47 持续存活未重启，`upgrade-state.ini` 同秒更新仅为“会话数变化”的常规落盘。现有审计无法区分“用户关闭 / 客户端关闭 / 异常关闭”。
  - 13:35–13:56 共享会话的 MCP 状态探针在 `ready` / `not_ready`（shell `unknown`）间反复横跳，期间伴随 4 次 `interrupt:true`。
  - 活动会话（如 6f9ca870、e3a1f3bd）无 raw-log 落盘，断链时刻的终端输出内容不可追溯。
- **建议**（待后续变更实施）:
  1. `session.closed` 审计事件补充 close reason / owner 字段。
  2. 所有活动会话启用输出日志落盘（raw-log），而非仅依赖内存 journal。
  3. 复核 MCP 状态探针的 `busy` / `not_ready` 语义与外部客户端重试策略，避免把“命令执行中”误判为“终端不可用”。
- **状态**: 待处理（未改，属文档范围）。
