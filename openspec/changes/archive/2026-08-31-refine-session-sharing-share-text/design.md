## Context

Synapse Term 的内嵌 MCP Server 已经具备回环监听、Bearer Token、显式 Sharing、外部调用管线、固定明文 Probe、输出脱敏和三档审批模式。当前问题集中在 Sharing 边界的契约没有完全收敛：

- Share Text 使用 Session 启动时的 `terminalType` 生成 Shell 指导，但用户进入 SSH、容器、WSL 或嵌套 Shell 后，当前 PTY environment 可能已经改变。
- `ExternalToolPipeline.status()` 只判断 PTY 是否运行，环境尚未验证时也返回 `ready`；环境方言不匹配却复用 `POLICY_DENIED`，还把过时的启动 hint 放进错误文本。
- `McpController.unshare()` 只清理 Pipeline 内部状态，不取消按 Session 等待中的 Approval Card；取消 Sharing 后，旧审批仍可能继续放行用户命令。
- `McpController` 的 Sharing IPC 操作没有返回声明的共享列表，真实 Electron 设置页的取消共享回调可能把列表状态更新为 `undefined`。

实现必须继续遵守单用户本地边界：Session 仍是应用持有的本地 PTY，Renderer 只能通过受限 preload API 访问能力，用户命令保持原文写入，固定 Probe 仍可能被目标 Shell、SSH 或远程服务器记录。

## Goals / Non-Goals

**Goals:**

- 让外部客户端能够区分 Session 过期、环境未就绪、Shell 方言不匹配、策略拒绝和审批拒绝。
- 让 `synapse_status` 反映真实的 PTY 运行态与当前 environment 验证态，并只返回外部客户端需要的有限 environment 摘要。
- 让 Share Text 不再把启动 Shell hint 当成当前 Shell 事实，并明确单 Session、原文命令、Probe 审计和 MCP 请求头前提。
- 让取消 Sharing、Session 退出、MCP 服务停用和 Token 变更对尚未写入 PTY 的外部调用立即生效；清理 Approval Card、Probe、会话内放行、Lease 和执行器状态。
- 修正真实 Electron 的 Sharing IPC 返回契约，并通过回归测试锁定上述边界。

**Non-Goals:**

- 不删除当前 PTY environment Probe，也不因提示太长而允许未经验证的结构化外部命令。
- 不自动把 PowerShell 命令翻译为 POSIX 命令，不使用 Base64、`eval`、`bash -c`、`EncodedCommand` 或隐藏 wrapper。
- 不把 MCP 改造成远程端点，不开放 Session 枚举，不把 Token 写入 Share Text、URL、sessionId 或 command。
- 不新增账户、远程主机资产、SSH 拓扑、凭据模型、跨重启 Session 或集中审计日志。
- 不修改已归档的 `dynamic-pty-environment-and-probe-visibility` Change。

## Decisions

### 1. 以当前 PTY environment 为事实，启动 Shell 只保留为 UI hint

`Share Text` 不再根据 `terminalType` 生成“只发送 PowerShell/POSIX 语法”的硬性指导。若界面需要展示启动信息，文案必须明确“仅供参考”；外部客户端应以 `synapse_status` 返回的 environment 摘要和执行前固定 Probe 为准。

`synapse_status` 对运行中的 Session 返回：

```text
status: ready | not_ready
environment: { dialect, platform, verificationStatus }
activeTransactionId?: string
guidance?: string
```

PTY 已退出或不再属于当前 Sharing 时返回 `expired`，不泄露其他 Session。PTY 运行但 environment 未验证、Probe 进行中或验证结果不完整时返回 `not_ready`，并指导外部客户端稍后重试；`status` 本身不创建 Lease、不写入 PTY。

备选方案是继续返回 `ready`，把环境问题留给 `synapse_execute`；这会使状态与下一次调用矛盾，因此不采用。

### 2. 将 Shell 方言不匹配作为独立的外部错误

`ExternalToolPipeline` 在环境 Probe 成功后继续进行方言检查，但不再用 `POLICY_DENIED` 表示 Shell 不匹配。新增稳定错误 `SHELL_MISMATCH`（或等价的环境类稳定码），错误文本只使用已验证的 current PTY environment，不展示启动 hint，并明确用户命令未发送和下一步。

环境 Probe 失败继续映射为 `SESSION_NOT_READY`，保留“未发送用户命令”的安全语义；真正由 PolicyEngine 或 Approval Mode 拒绝的调用才使用 `POLICY_DENIED` 或 `APPROVAL_DENIED`。显式提交的 `powershell.exe -Command ...` 仍按完整原文处理，但 Share Text 不主动诱导外部客户端添加 wrapper。

### 3. 用 Pipeline generation 和按 Session Approval 清理实现撤销失效

每个 `ExternalToolPipeline` 增加 disposed/generation 状态。`clear()` 必须幂等地：

1. 标记 Pipeline 不再接受任何后续授权继续；
2. 取消当前 Probe；
3. 清除会话内放行和外部 Lease；
4. 中断仍在运行的外部事务并释放执行器监听；
5. 让 Probe、Policy、Approval 等异步边界恢复后再次检查 generation，旧调用不得进入 `CommandExecutor`。

`ApprovalQueue` 增加按 `sessionId` 取消能力。取消 Sharing 或 Session 退出时，先使 Pipeline 失效，再取消该 Session 的当前/排队 Approval Card；取消后的旧审批 ID 不得再决定任何调用。MCP 服务停用、Token 吊销或 Token 重新生成时，取消全部外部调用并清除全部 Sharing，重新启用后必须由用户再次 Sharing。

已经写入 PTY 的命令无法撤回；系统只对尚未写入的 Probe/审批/授权阶段做强制阻断，对已开始事务执行尽力中断并如实返回 `interrupted` 或相应终态。

备选方案是只清除 Lease；由于 Approval Promise 可能在清除后恢复，旧调用仍会继续执行，因此不采用。

### 4. 收敛 Sharing IPC 返回值

`McpController.share()` 与 `unshare()` 都返回当前 `listShared()` 快照，保持与 `DesktopApi`、preload 和 Settings Workspace 的既有契约一致。Main IPC handler 原样转发该结果；Renderer 不接触 Controller、Pipeline 或 PTY 内部状态。

设置主题在 MCP 设置变更后重新读取 status 与 shared 列表，保证停用 MCP、Token 变更和取消 Sharing 后 UI 与 Main 状态一致。

### 5. Share Text 只保留可执行的协议前提

Share Text 采用固定结构：内嵌 MCP Server 前提、MCP 服务中配置 `Authorization: Bearer <Token>`、单个 `sessionId`、工具顺序、当前 environment 以运行时为准、用户 command 原文发送、Probe 可能被审计、失败后的重试边界。真实 Token 永远不进入文本。

Session Alias 和启动 Shell 等用户可编辑字段在写入 Share Text 前转换为单行安全展示文本，避免换行或低位控制字符破坏提示词结构。Share Text 不承担权限授予；只有 Main 中当前 Sharing registry 的 Session 才能被外部调用寻址。

### 6. 完成帧之后保留有限的 PTY 输出排空窗口

当前 `CommandExecutor` 在收到匹配的 OSC 777 完成帧时立即移除输出监听并快照 `OutputBuffer`。这依赖“命令 stdout 必然在完成帧之前抵达 Main”的假设；在 SSH/zsh 等嵌套 PTY 场景，stdout 可能在相邻的后续 PTY 数据事件中抵达，造成事务已完成但返回结果缺少 stdout。

收到匹配完成帧后，事务先进入 `completion_pending` 内部阶段，在一个很短且有上限的 drain window 内继续接收同一 Session 的 `pty_output`，然后再生成最终结果并移除监听。drain window 只处理已进入 Main 的 PTY 输出，不重新执行命令、不等待新的 Probe、不改变退出码，也不把后续外部调用并入本事务。PTY 退出时立即结束排空并如实返回已捕获结果；窗口到期后仍以完成帧为完成证据。

排空窗口的默认值保持很小，并通过 `CommandExecutorOptions` 可注入以便测试；它不是无限等待，也不以固定长 sleep 代替完成条件。完成帧之前的顺序和协议过滤保持不变，完成帧之后仅追加窗口内真实收到的业务输出，因此外部客户端可以稳定获得 `uname -s` 的 `Darwin` 等结果。

备选方案是要求所有远端 Shell 严格保证完成帧之后没有任何输出；该假设已被实际 SSH/zsh 现象否定，因此不采用。把完成 Probe 改成远端 shell wrapper 也会破坏明文审计边界，同样不采用。

## Risks / Trade-offs

- [取消 Sharing 时命令已经写入 PTY] → 不伪造撤回；对已开始事务尽力发送中断并返回真实终态，未写入阶段由 disposed/generation 检查阻断。
- [完成帧后的迟到 stdout 被漏掉] → 完成后使用有上限的 PTY 输出排空窗口，并增加完成帧前后、跨数据块和 SSH/zsh 形态的回归测试；窗口到期不影响完成状态。
- [全局 ApprovalQueue 中多个 Session 交错排队] → 按 Session 精确取消，不用“取消当前”误伤其他 Session；修正队列 current/pending 的幂等状态流转。
- [Token 变更后用户需要重新 Sharing] → 这是显式撤销的可理解代价，设置页刷新共享列表并给出重新 Sharing 指引。
- [外部客户端仍缓存旧 Share Text] → 错误稳定码和“重新 Sharing/重试”的恢复指引让客户端停止盲目重复旧命令；Session ID 本身不作为认证凭据。
- [方言检测正则误判命令文本] → 本 Change 先保证错误分类和安全文案；保留原文命令边界，补充字符串/参数场景测试，后续再独立收紧检测器。
- [当前 PTY environment 摘要暴露过多内部状态] → 只返回 dialect、platform、verificationStatus，不返回 capability epoch、PTY 对象、Lease、Token 或其他 Session 列表。

## Migration Plan

1. 先为 ApprovalQueue 按 Session 取消、Pipeline disposed/generation、Controller IPC 返回值和当前状态三态补充失败测试。
2. 实现 Main 侧清理顺序：Session 失效/取消 Sharing/Token 变更 → Pipeline 失效 → Approval 清理 → 外部执行器/租约清理。
3. 调整 `synapse_status`、环境错误分类和 Shell mismatch 文案，保留 CommandExecutor 的原文发送与固定明文 Probe。
4. 重写 Share Text、ShareDialog 服务状态提示和 Settings Workspace 列表刷新；补充 Mock、普通 Playwright 和真实 Electron 场景。
5. 运行定向测试、`pnpm verify`、构建、E2E 与 OpenSpec strict 校验。

回滚时可恢复旧的 Share Text 和状态文案，但不能恢复“取消 Sharing 后旧审批可继续执行”的行为；新的清理逻辑是安全边界修复。新增外部错误码与 status 字段保持向后兼容，旧外部客户端仍可按稳定错误前缀处理。

## Open Questions

- 外部客户端是否需要在 `synapse_status` 中显示当前 `dialect` 的完整标签，还是仅使用 `posix`/`powershell` 枚举；本 Change 先使用稳定枚举，避免将启动 Shell 名称重新带入协议。
- 目前没有独立的 UI 审计日志；已写入 PTY 的撤销/中断结果继续依赖现有 `mcp:execution` 实时事件和事务结果，不新增持久化审计模型。
