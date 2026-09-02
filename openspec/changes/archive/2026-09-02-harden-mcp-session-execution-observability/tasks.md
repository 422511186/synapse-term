## 1. 公共契约与 Session 状态

- [x] 1.1 在 `@synapse-term/domain` 与 `@synapse-term/terminal-service` 的公共出口中定义执行上下文 ID、外部事务状态、事务输出范围、完成信息和稳定错误码的共享类型，并区分 `executionContextId`、`capabilityEpoch`、`transactionId` 与 `outputCursor`；通过类型检查和现有公共出口测试验证跨包引用不绕过 `src/index.ts`。
- [x] 1.2 为 `SessionActor` 增加独立执行上下文状态和轮换规则：用户输入/环境失效时失效，上下文相关的外部事务提交时轮换，被动 PTY 输出不轮换；补充用户输入、外部 Probe、外部 command 和被动输出的单元测试验证状态变化。
- [x] 1.3 将外部写入改为同一 Session 串行队列内的原子“校验并写入”操作，同时校验 `expectedContextId`、已验证的 `capabilityEpoch` 和 PTY 运行状态；为用户输入先到、上下文失配、环境未验证和外部写入成功分别补充测试，确认失败路径不会写入用户 command。

## 2. Sharing 级 PTY 输出历史

- [x] 2.1 在 `apps/desktop/src/main/mcp/` 增加 Sharing 输出历史组件，以服务端生成且带 Session/Sharing 作用域的游标维护有界环形窗口；实现省略 `afterCursor` 的首次读取、`tail`、服务端 `maxBytes`、`nextCursor`、`hasMore`、`historyTruncated` 和 `earliestCursor`，通过单元测试验证重复读取不消费历史及超出保留窗口的结果。
- [x] 2.2 让 `McpController.share()` 在订阅 `SessionActor` 公共 `pty_output` 事件时创建历史采集器，并让 `unshare`、Session 退出、Token 变更和端点关闭释放采集器；补充已有历史不回放、取消后重 Share 重置边界、旧游标和其他 Session 不可读取的测试。
- [x] 2.3 保证采集顺序为协议帧/Probe 隔离、低位控制字符清理、连续文本脱敏、写入历史和分页；实现跨 PTY 事件、内部输出块、UTF-8 字符及外部页边界的流式脱敏测试，确认 OSC 777、Probe 原文、未回显按键和原始 PTY 字节不会进入历史。
- [x] 2.4 保持终端 UI 输出路径与 MCP 历史路径独立，验证 `hideCompletionProbeEcho` 只影响本地 UI 而不改变 Probe 写入、协议解析或外部脱敏历史；通过 `session-actor` 和 MCP 输出测试覆盖开关的两种状态。

## 3. 当前 PTY 环境与字面 Shell 审计

- [x] 3.1 更新 `ShellProbe` 和当前环境状态，使执行总是基于运行时 Probe 识别的方言/平台，而不是启动提示；验证 PowerShell 启动提示进入 POSIX SSH、容器或 WSL 后必须重新验证 capability epoch，且 Probe 失败不会发送用户 command。
- [x] 3.2 在 `ShellDriver` 的字面分发入口统一校验 NUL、非法低位控制字符、伪造 OSC 777、保留事务边界标记和当前 Driver 不可安全提交的输入；增加已知 `ssh`、`docker exec -it` 及终端程序的 `INTERACTIVE_COMMAND_UNSUPPORTED` 判定测试，确认不触发任何 PTY 写入。
- [x] 3.3 保持 POSIX 与 PowerShell 的独立固定完成 Probe：原文 command 后紧跟 Probe，Probe 读取对应退出状态并携带 nonce，PowerShell 路径覆盖 `$?`/`$LASTEXITCODE` 且不得出现 `-EncodedCommand`；通过现有 shell-driver、Probe 和真实 PTY 集成测试验证完成帧可解析。
- [x] 3.4 为 Probe、审批和最终写入之间增加执行前再验证，并验证外部 Probe/command 写入不冒充用户接管；使用可控 Fake Backend 测试用户在 Probe 或审批期间输入时返回 `EXECUTION_CONTEXT_STALE`/`SESSION_NOT_READY` 且不写入旧 command。

## 4. 外部事务收敛

- [x] 4.1 重构 `CommandExecutor` 的外部事务模型，使已接受事务只公开 `running`、`completed`、`interrupted`、`unknown`，记录起始/当前输出游标、退出码、完成信息和不可自动重提标记；为写入前拒绝不创建 `transactionId`，并用单元测试覆盖非零退出码仍为 `completed`。
- [x] 4.2 将完成帧监听、协议帧过滤和有限 drain window 接入 Sharing 输出历史，确保完成帧之后已到达的普通 stdout 保持顺序并进入事务输出范围；通过分块到达、控制帧分割和 late output 测试验证不泄露 Probe。
- [x] 4.3 实现 `synapse_wait` 的单次等待默认 30 秒、上限 60 秒语义：超时只返回 `running` 快照且事务可继续等待、观察或中断；通过假定时器测试确认等待超时不会改变事务终态。
- [x] 4.4 处理 PTY 退出、Probe 丢失、用户输入干扰、Sharing 销毁和连接异常导致的完成证据缺失，将可能已执行的事务收敛为 `unknown`，返回 `retryable: false` 与 `safeToResubmit: false`，并用测试确认不得自动重提或把后续输入归入旧事务。
- [x] 4.5 保持每个共享 Session 只有一个活动外部事务，统一 `ExternalLeaseRegistry` 与 Executor 状态的释放/中断时序；通过并发 `synapse_execute`、正常完成、未知终态和 `synapse_interrupt` 测试验证第二个 command 不会写入 PTY，且不声称远程进程已终止。

## 5. Main 外部调用管线

- [x] 5.1 更新 `ExternalToolPipeline.execute()` 要求并校验 `expectedContextId`，按“获取当前环境 → 固定 Probe → 字面审计/交互式判断 → 风险分类 → 审批 → 最终原子校验并写入”的顺序执行；为缺少/失配上下文分别验证 `EXECUTION_CONTEXT_REQUIRED`、`EXECUTION_CONTEXT_STALE`、原因指引和零用户写入。
- [x] 5.2 扩展 `PolicyEngine` 的风险结果为 `risk`、`confidence`、`reasons`、`requiresConfirmation`，对脚本、别名、动态替换和复杂管道保守降级；验证三档审批模式、全文精确的会话内放行及审批返回后的上下文再验证仍符合 ADR-0015。
- [x] 5.3 将 `observe()` 改为读取当前 Sharing 历史而非最近事务临时缓冲，并让 `execute`/`wait` 返回有限即时输出、事务输出范围、下一游标和当前执行上下文 ID；通过跨事务、无事务、分页重复读取、`tail` 与历史截断测试验证字段和边界。
- [x] 5.4 让 `status()` 保持单 Session、只读和不触发 Probe：未验证环境返回 `not_ready` 及本地 readiness guidance，已验证环境返回受限摘要，未 Sharing/退出/失效返回 `expired`，且任何 status 响应都不含 `executionContextId`、capability epoch、Lease 或其他 Session 信息。
- [x] 5.5 更新 `McpController` 的 Sharing 生命周期、活动事务清理、审批取消和 Token/端点变更处理；通过 controller 测试验证旧 pipeline、事务、游标和审批不会跨越新的 Sharing 边界继续使用。

## 6. MCP 工具契约与 Share Text

- [x] 6.1 更新 `mcp-tools.ts` 的 Zod Schema 和描述，确保端点只注册五个 `synapse_*` 工具；验证 `synapse_execute` 必填 `expectedContextId`，`synapse_observe` 的 `tail` 与 `afterCursor` 互斥且 `maxBytes` 受限，`synapse_wait` 的超时范围为默认 30 秒至最多 60 秒。
- [x] 6.2 统一工具错误序列化，使稳定错误码位于文本开头并同时包含原因和下一步指引，覆盖 `SESSION_NOT_READY`、`SESSION_EXPIRED`、`SESSION_BUSY`、`TRANSACTION_NOT_FOUND`、审计/交互式拒绝、上下文错误、Shell 不匹配和审批错误；测试确认错误不泄露其他 Session、Token、Probe 原文或原始 PTY 数据。
- [x] 6.3 更新 `apps/desktop/src/renderer/mcp/share-text.ts` 及 Share Text UI，明确“status → observe 获取终端内容和 `executionContextId` → 带 `expectedContextId` execute → wait/observe”的流程、`tail` 恢复方式、原文 command 和 Probe 可被目标 Shell/SSH/远程服务器记录；通过测试确认不包含真实 Token、URL、其他 Session 或过时启动 Shell 事实。
- [x] 6.4 检查并更新涉及 MCP 字段的 preload/IPC 公共类型和 Renderer 调用，确保 Renderer 仍只通过受限 API 获取 Share Text/状态，Main 仍是 PTY、Session、历史和外部调用的唯一持有者；通过 `desktop-ipc-contract` 与相关类型检查验证没有新增 Node/PTY 直达路径。

## 7. 集成验证与交付检查

- [x] 7.1 先补齐 terminal-service 回归测试矩阵，覆盖 SessionActor 串行竞态、输出帧/Probe 隔离、环境 epoch、执行上下文、Shell Driver、事务状态和中断语义；运行对应 Vitest 测试确认核心行为通过。
- [x] 7.2 补齐 Main MCP 的 pipeline、controller、工具 Schema、SecretRedactor、Sharing 历史和 Share Text 测试，覆盖分页长输出、脱敏跨页、旧游标、稳定错误和审批竞态；运行对应 Vitest 测试确认协议字段与安全边界通过。
- [x] 7.3 更新 Mock Renderer 和条件式 Electron Playwright 流程，验证真实 MCP 调用必须先 observe、失配后 tail/observe 恢复、长事务 wait 超时、unknown 禁止重提以及取消 Sharing/Token 变更后的失效行为；运行 `pnpm test:e2e` 验证端到端流程。
- [x] 7.4 运行 `pnpm verify`、必要的覆盖率检查和最终 OpenSpec 校验，确认格式、ESLint、TypeScript、Vitest、规格场景及五工具契约均通过，并检查变更中没有加入持久化日志、凭据、远程拓扑或屏幕快照实现。
