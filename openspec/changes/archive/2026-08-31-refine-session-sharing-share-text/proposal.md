## Why

当前 Sharing 的执行边界基本正确，但外部客户端看到的状态和错误信息仍混用了启动时 Shell hint 与当前 PTY environment：环境不匹配被标成 `POLICY_DENIED`，Share Text 也可能把已经过时的 PowerShell 提示传递给外部客户端。与此同时，取消 Sharing 或 Session 失效时，已经进入审批等待的外部调用没有与 Sharing 生命周期绑定，存在撤销后继续写入 PTY 的竞态。

现在需要把 Sharing、Share Text、当前 PTY environment 状态和外部调用撤销收敛为一个一致的可审计契约，确保外部客户端能区分“命令不匹配”“环境未就绪”“策略拒绝”和“Session 已失效”，并让尚未写入 PTY 的外部调用在撤销后安全终止。

## What Changes

- 新增 MCP Sharing 生命周期契约：只有用户明确完成 Sharing 的 Session 才能被外部客户端寻址；取消 Sharing、Session 退出、MCP 服务停用或 Token 吊销时，未完成且尚未写入的外部调用 MUST 失效。
- 为按 Session 归属的审批等待、Probe、会话内放行、外部租约和执行器增加幂等清理；取消 Sharing 后旧审批卡片不得再放行用户命令，已写入 PTY 的命令只能尽力中断并如实返回结果。
- 让 `synapse_status` 诚实反映 `ready`、`not_ready`、`expired`，并在已验证时提供受限的当前 PTY environment 摘要；环境未验证不得伪装成 ready。
- 将 Shell 方言不匹配从 `POLICY_DENIED` 中分离为稳定的环境类错误；错误 MUST 说明当前已验证环境、用户命令未发送以及下一步，不再展示过时的启动 Shell hint。
- 确保外部事务在完成 Probe 到达后仍能收集同一 PTY 数据流中迟到的 stdout，避免 SSH/zsh 场景出现事务已完成但结果只有命令回显。
- 重写 Share Text：不把启动 Shell 当作当前环境事实，不放入真实 Token，不要求外部客户端自行翻译、编码或包装用户命令；明确内嵌 MCP Server、请求头配置位置、单个 Session、工具使用顺序、当前 PTY environment 和 Probe 的审计语义。
- 分享对话框和已共享 Session 列表 MUST 区分“Session 已共享”与“内嵌 MCP Server 当前可连接”，避免 MCP 服务未运行时给出已配置的误导提示。
- 不改变内嵌 MCP Server 的回环监听、Bearer Token 请求头、无 Session 枚举、用户命令原文传输、固定明文 Probe、输出脱敏和三档审批模式。

## Capabilities

### New Capabilities

- `mcp-session-sharing`: 规定 Sharing、Share Text、外部 Session 状态、环境类错误和撤销/失效时的外部调用清理边界。

### Modified Capabilities

<!-- 本变更的外部 Sharing 契约在新的 mcp-session-sharing 能力中集中定义；既有当前 PTY environment 的执行安全要求保持不变。 -->

## Impact

- `apps/desktop/src/main/mcp/`：调整 McpController、ExternalToolPipeline、ApprovalQueue 和 MCP 工具状态/错误返回，补齐按 Session 的取消与生命周期清理。
- `apps/desktop/src/renderer/mcp/`、`apps/desktop/src/renderer/app.tsx`：重写 Share Text 与 Sharing 对话框文案，展示真实 MCP 服务状态并保持 Token 不进入 Share Text。
- `apps/desktop/src/shared/`、`packages/domain/`：如需要新增稳定外部错误码、状态摘要和 Sharing 领域契约，必须通过公共出口与受限 preload API 传递。
- 测试：增加 Share Text 动态环境文案、状态三态、环境不匹配错误、审批中取消 Sharing、执行中撤销、Token 吊销、Session 退出和 MCP 服务状态提示的单元、集成与 Electron E2E 覆盖。
- 不新增远程端点、账户、主机资产、凭据持久化或集中审计日志；不修改已归档的 `dynamic-pty-environment-and-probe-visibility` Change。
