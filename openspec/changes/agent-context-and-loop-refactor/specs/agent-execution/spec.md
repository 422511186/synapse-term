## MODIFIED Requirements

### Requirement: Restricted Terminal Tools
内置 Agent MUST 只能调用 `terminal.observe`、`terminal.execute`、`terminal.wait`、`terminal.interrupt`、有界附件文件工具 `local_list_files`、`local_search_files`、`local_read_file`、`local_write_file`、`local_edit_file`，以及只读上下文召回工具 `context_recall`；不得获得任意本机文件、浏览器或插件访问。本地文件工具 MUST 只能访问当前 Session/Agent 附件根目录及其子路径，不得因用户附件而扩大为任意路径访问。`context_recall` MUST 是只读上下文管理工具——MUST NOT 访问 PTY、文件系统或 Provider keys，MUST NOT 改变任何状态，只按 `toolCallId` 查本会话 append-only `#items` 历史并按 `startLine`/`endLine`/`maxBytes` 切片返回（详见 `context-governance` capability 的 Context Recall Tool 要求）。`local_write_file`/`local_edit_file` 的副作用安全 MUST 仍由 approval/lease/audit 第一道防线兜底，本 allowlist 登记不放宽其审批语义。未知工具 MUST 被拒绝并记录协议错误。

#### Scenario: Model requests an unknown tool
- **WHEN** Provider 返回不在允许集合中的 Tool Call
- **THEN** AgentRuntime 拒绝执行并记录协议错误

#### Scenario: Agent reads a staged attached file
- **WHEN** 模型调用 `local_read_file` 且路径指向用户附件清单中的相对路径
- **THEN** ToolGateway MUST 返回文件内容，且路径被限制在附件根目录内

#### Scenario: Agent requests an absolute file path
- **WHEN** 模型调用 `local_read_file` 并传绝对路径
- **THEN** ToolGateway MUST 返回可恢复的 `invalid_tool_call`，不能读取附件根目录外的文件

#### Scenario: Agent recalls a spilled result via context_recall
- **WHEN** 模型调用 `context_recall` 并指定已被外溢的 `toolCallId` 与切片参数
- **THEN** Runtime 从 `#items` 查原始 `tool_result`、按切片返回受限片段，MUST NOT 访问 PTY/文件系统/Provider keys，MUST NOT 改变状态

#### Scenario: Side-effecting file tools keep approval semantics
- **WHEN** 模型调用 `local_write_file` 或 `local_edit_file`
- **THEN** 该调用 MUST 仍经 approval/lease/audit 审批，allowlist 登记不放宽副作用安全边界

### Requirement: Recoverable Tool Call Errors
模型可自行修正的工具调用错误（如 Schema 校验失败、参数不满足路径/长度约束）MUST 由 ToolGateway 标记为可恢复（`recoverable: true`）并附带说明原因的 `message`；AgentRuntime MUST 把该错误作为 `tool_result`（`isError: true`）回传给模型并继续下一轮规划，MUST NOT 因单次此类错误终止整个任务。同一签名连续无进展的失败调用 MUST 受 LoopDetector 分级裁决保护（详见 `Loop Detection Graded Verdicts` 要求），MUST NOT 退化为单路径硬失败。**命令不可用重复保护（`#lastUnavailableCallSignature`）MUST 与 LoopDetector 协调**：当一条命令因 `command_unavailable` 类错误失败后，Runtime 记录该签名；若模型在未产生新证据（未切换工具族/未改参数/未产生新进展）的情况下重发同一不可用命令，MUST 交给 LoopDetector 按 `SameToolError`/`NoProgress` 路径分级裁决（Nudge→ForceStop），MUST NOT 在第二次同签名不可用命令时直接 `#finish('failed', 'repeated_command_without_new_evidence')` 硬失败绕过 LoopDetector。审批失效、策略拒绝等环境性错误 MUST 保持现有终止语义，不得被本要求或分级裁决放宽。truthful-tools-first：LoopDetector 只裁决"重复无进展"，MUST NOT 约束首次破坏性调用——副作用安全由 approval/lease/audit 第一道防线保障。

#### Scenario: Invalid local file path is fed back for re-planning
- **WHEN** 模型调用 `local_read_file` 且参数含绝对路径，Schema 校验失败
- **THEN** ToolGateway MUST 返回 `recoverable: true` 的 `invalid_tool_call` 并附带字段与原因提示，AgentRuntime MUST 将错误作为 tool_result 回传模型并继续，模型可在下一轮改用相对路径重试

#### Scenario: Loop detector grades repeated no-progress calls
- **WHEN** 模型对同一非法调用签名连续提交且未产生新进展
- **THEN** LoopDetector 按分级裁决（Continue/Nudge/ForceStop）处理，MUST NOT 直接以单路径 `agent_loop_limit_reached` 硬失败

#### Scenario: Repeated unavailable command goes through loop detector, not hard-fail
- **WHEN** 一条命令因 `command_unavailable` 失败后，模型在未产生新证据的情况下重发同一不可用命令签名
- **THEN** Runtime MUST 把该重复交由 LoopDetector 按 `SameToolError`/`NoProgress` 路径分级裁决（Nudge→ForceStop 滚动窗口），MUST NOT 在第二次同签名不可用命令时直接 `#finish('failed', 'repeated_command_without_new_evidence')` 绕过 LoopDetector

#### Scenario: Environmental errors keep their failure semantics
- **WHEN** 工具调用因审批失效或策略拒绝等环境性原因失败
- **THEN** 任务 MUST 保持既有失败/暂停语义，不因可恢复机制或分级裁决改变

### Requirement: Post-Tool Completion Review
AgentRuntime MUST 在本 Turn 调用过任一 Tool 后，将第一个不含 Tool Call 的 Assistant 文本视为候选答案，并使用同一模型选择、原始用户目标、结构化 Tool evidence 和当前结构化 progress snapshot 执行有界 completion review。候选答案 MUST 不进入 Assistant history 或 review context；如果 review 发现工作缺失，Runtime MUST 继续既有有界 Tool Loop 并更新 progress；确认完成后 SHALL 只发布并持久化一个完整、自包含且不引用隐藏候选文本的最终答案。候选文本和内部 review 指令 MUST 不进入用户 Timeline 或 Conversation history。completion review 次数上限 MUST 调整为 2（原为 3）。completion review 失败时 MUST 优雅降级返回原始候选答案（Ch11 graceful degradation），MUST NOT 硬失败为 `agent_completion_review_failed`。ForceStop-with-summary MUST 复用本要求的"无工具最终模型调用"管道作为循环卡死时的总结路径（触发器 B），但 MUST 跳过"不完整则继续调工具"子分支——ForceStop 后不再进入 ReAct。

#### Scenario: Model stops after partial diagnostics
- **WHEN** 用户请求多个服务器指标，但模型只为其中一部分调用 Tool 后输出无 Tool Call 的候选答案
- **THEN** Runtime 进入 `verifying` progress，不完成或发布候选答案；当 review 发现 evidence 缺失时继续既有 Terminal Tool loop

#### Scenario: Complete a pure conversation without review
- **WHEN** 当前 Turn 未调用 Tool 且模型直接回答普通对话
- **THEN** Runtime 发布文本流并完成，不执行 completion review 或创建 progress Tool steps

#### Scenario: Completion review limit is exhausted
- **WHEN** Tool task在 completion review 次数上限（2 次）内仍未确认完成
- **THEN** Runtime 优雅降级返回原始候选答案，MUST NOT 硬失败为 `agent_completion_review_failed`，并保留 Tool/audit evidence

#### Scenario: Reviewer would reuse the hidden candidate
- **WHEN** 候选文本对用户不可见且 review 确认所有目标都有 evidence
- **THEN** review 从原始目标、Tool evidence 和 progress 状态生成完整自包含答复，不得引用不可见候选文本

#### Scenario: ForceStop reuses the tool-free final call pipeline
- **WHEN** LoopDetector 返回 ForceStop 裁决
- **THEN** Runtime 注入 ForceStop 消息并走一次无工具最终模型调用（复用 completion review 管道），但跳过"不完整则继续调工具"子分支，总结经 `FORCE_STOP_SUMMARY_PROMPT`（继承 `SUMMARY_SYSTEM_PROMPT` 禁令 + 强化"不得声称已验证、不得推测未执行的工作"）脱敏后发布

## ADDED Requirements

### Requirement: Loop Detection Graded Verdicts
AgentRuntime MUST 用 LoopDetector 对无进展循环做分级裁决，替换单路径 `{name,arguments,result}` 签名比对。LoopDetector MUST 按以下路径**按序求值，先命中者胜**——每条路径编码的是"无进展"的不同定义，并行评估会掩盖最具体的信号。初始实施 MUST 覆盖 4 条核心路径 + 错误预算非对称 + `[validation error]` 短路；其余 5 条形状判定路径 SHOULD 增量补（路径从事故长出，初始全做风险高；spec 不得把 9 条全写 MUST 而实施只做 4 条导致矛盾）。

**MUST（4 条核心 + 错误预算非对称 + `[validation error]` 短路）：**
- ConsecutiveDuplicate：同 `name+arguments+result` 签名连续重复，阈值 3 → Nudge。
- ExactDuplicate：同 `name+arguments`（不比 result）累计达阈值 5 → ForceStop（覆盖 ConsecutiveDuplicate 含 result 抓不到的情况）。
- SameToolError：同一工具连续返回 `isError`，阈值 = 正常路径阈值（3）→ Nudge→ForceStop。
- NoProgress：通用 `#recordNoProgress` 签名无进展，阈值 3 → Nudge→ForceStop。
- 错误预算非对称：全错误路径阈值 MUST 为正常路径的 2×（"重试失败操作是正当工作"、"重复的失败常常是进展"）——正常路径阈值 3、全错误路径阈值 6，计数达 6 时触发（即第 6 次连续错误调用）；成功（gateway 层 `result.ok === true && result.isError !== true`，不要求结果有信息量）MUST 打断连续错误计数，MUST NOT 在模型刚挣脱错误时惩罚。
- `[validation error]` 短路：同一工具 + 同一参数 + 连续 3 次校验错误直接 ForceStop，远早于通用全错误预算的第 6 次。

**SHOULD（5 条形状判定，增量补）：**
- EmptyThink：模型本轮未产出任何 text_delta 且未发出 tool_call，连续 2 次 → Nudge。
- ToolModeSwitch：工具族切换（如 observe→execute）后立即回到旧族且无进展 → Nudge。
- SuccessAfterError：gateway 层 `result.ok && !isError` 后首次成功的**独立显式 Continue 路径**（"模型刚挣脱时显式不罚"）。注：错误预算非对称中的"成功打断连续错误计数"是 MUST 行为，本路径只是其显式裁决的增量精化。
- FamilyNoProgress：同工具族（terminal/local）无进展，连续 4 次 → Nudge。
- SearchEscalation：search 类工具 query 逐次放大无进展，连续 3 次 → Nudge。

三级裁决 MUST 为：Continue（继续 ReAct）/ Nudge（滚动窗口内必须升级，否则升 ForceStop——无上限的 Nudge 视为装饰）/ ForceStop（注入总结消息 + 一次无工具最终调用）。Nudge→ForceStop 滚动窗口 = 2 次后续调用，若 2 次内未升级（未切换工具族/未改参数/未产生新进展签名）则升 ForceStop。ForceStop-with-summary MUST 复用 `Post-Tool Completion Review` 的无工具最终模型调用管道。truthful-tools-first：LoopDetector 只裁决"重复无进展"，MUST NOT 约束首次破坏性调用——副作用安全由 approval/lease/audit 第一道防线保障。

#### Scenario: Consecutive duplicate triggers Nudge then ForceStop
- **WHEN** 模型连续 3 次提交相同签名的无进展调用
- **THEN** LoopDetector 返回 Nudge，Runtime 注入升级提示；若滚动窗口内未升级则升为 ForceStop

#### Scenario: Exact duplicate hits ForceStop at raised threshold
- **WHEN** 模型连续 5 次提交完全相同的调用
- **THEN** LoopDetector 返回 ForceStop，Runtime 走无工具最终总结管道

#### Scenario: Success breaks the error streak
- **WHEN** 模型在连续错误后首次成功（gateway `result.ok` 且非 `isError`）
- **THEN** 该成功 MUST 打断连续错误计数，LoopDetector MUST NOT 在挣脱时刻惩罚模型（显式 SuccessAfterError 路径为 SHOULD 增量精化，但"成功打断错误计数"是 MUST 行为）

#### Scenario: All-error path uses doubled budget
- **WHEN** 模型连续提交失败调用且无成功
- **THEN** 通用全错误路径在第 6 次调用触发（正常路径阈值 3 的 2×），而非正常路径的阈值，因为"重试失败操作是正当工作"

#### Scenario: Validation error short-circuits to early ForceStop
- **WHEN** 模型对同一工具以同一参数连续 3 次产生 `[validation error]` 前缀的校验错误
- **THEN** LoopDetector 直接返回 ForceStop，远早于通用全错误预算的第 6 次

#### Scenario: First destructive call is not constrained by loop detection
- **WHEN** 模型首次提交一个破坏性调用
- **THEN** LoopDetector MUST NOT 约束首次调用，副作用安全由 approval/lease/audit 第一道防线保障，探测器只管"重复"

#### Scenario: Shape-detection paths are incremental
- **WHEN** 初始实施仅覆盖 4 条核心 MUST 路径而未实现 5 条 SHOULD 形状路径
- **THEN** LoopDetector 仍满足 MUST 合规；5 条 SHOULD 路径（EmptyThink/ToolModeSwitch/SuccessAfterError/FamilyNoProgress/SearchEscalation）按事故增量补入，MUST NOT 因未实现 SHOULD 路径而破坏 MUST 路径的先命中者胜求值顺序
