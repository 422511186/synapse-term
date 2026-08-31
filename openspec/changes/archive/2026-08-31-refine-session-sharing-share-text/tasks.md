## 1. 外部 Sharing 契约与状态

- [x] 1.1 为 `ExternalErrorCode`、`ExternalToolPipeline.status()` 和 MCP 结果补充 `SESSION_NOT_READY`、`SHELL_MISMATCH` 及受限 current PTY environment 摘要的失败测试
- [x] 1.2 修正 `ExternalToolPipeline.status()` 的 `ready`/`not_ready`/`expired` 三态和 guidance，确保 status 不创建 Lease、不写入 PTY
- [x] 1.3 将环境 Probe 失败映射为 `SESSION_NOT_READY`，将 Shell 方言不匹配映射为 `SHELL_MISMATCH`，移除错误中的启动 Shell hint，并验证用户 command 未写入
- [x] 1.4 保持 PolicyEngine/Approval Mode 的 `POLICY_DENIED`、`APPROVAL_DENIED` 语义独立，补充方言错误与策略错误的区分测试

## 2. Sharing 撤销与审批生命周期

- [x] 2.1 为 `ApprovalQueue` 增加按 `sessionId` 取消当前和排队 Approval Card 的失败测试，修正 current/pending 队列的幂等清理
- [x] 2.2 为 `ExternalToolPipeline.clear()` 增加 disposed/generation 语义，补充 Probe、Approval、异步授权恢复后不得继续执行的失败测试
- [x] 2.3 实现 Pipeline 清理时的外部事务尽力中断、执行器监听释放、Lease/会话内放行清理，并覆盖已写入命令只能返回真实终态
- [x] 2.4 修改 `McpController.unshare()`、Session removal、MCP 停用和 Token 变更的清理顺序，确保旧 Approval ID 无法继续放行用户 command
- [x] 2.5 为 Token 吊销/重新生成和 MCP 服务停用增加全部 Sharing 清理、旧外部调用失效及重新 Sharing 的回归测试

## 3. Sharing IPC 与 Renderer 状态

- [x] 3.1 让 `McpController.share()` 与 `unshare()` 返回 `SharedMcpSession[]` 快照，并补充真实 IPC handler/preload 契约测试
- [x] 3.2 让 Settings Workspace 在 MCP 设置变更和取消 Sharing 后重新读取 status/shared，避免列表出现 `undefined` 或过期条目
- [x] 3.3 调整 ShareDialog 的 MCP Server 状态文案，区分 Session 已 Sharing 与内嵌 MCP Server 当前可连接
- [x] 3.4 补充服务停用、Token 缺失、Token 变更和共享列表刷新的 Renderer/Playwright 回归测试

## 4. Share Text 与命令提示

- [x] 4.1 以 TDD 重写 `buildShareText()`：删除基于启动 Shell hint 的强制语法指导，加入 current PTY environment、Probe 审计、原文命令和恢复流程说明
- [x] 4.2 为 Share Text 增加真实 Token 不泄露、单个 sessionId、无其他 Session、禁止隐式翻译/编码/wrapper 以及 PowerShell→POSIX 场景测试
- [x] 4.3 将 Session Alias、Shell hint 等用户可编辑字段限制为单行安全文本，覆盖换行和低位控制字符
- [x] 4.4 更新 ShareDialog 文案、预览和普通 Playwright/Electron E2E 断言，确保外部客户端可以直接理解 MCP 配置位置和工具顺序

## 5. SSH/zsh 输出完整性

- [x] 5.1 先增加完成帧前后、同一数据块和跨多个 PTY 数据块的 CommandExecutor 输出失败测试，复现完成但 stdout 缺失的场景
- [x] 5.2 为 `CommandExecutor` 增加可注入且有上限的 completion drain window，在完成帧后收集迟到 stdout，不改变命令原文、退出码和 Probe 语义
- [x] 5.3 覆盖 Windows 本地 PTY SSH 到 macOS zsh 执行 `uname -s` 返回 `Darwin`、命令回显保留、OSC 777/Probe 噪声过滤和不重复输出
- [x] 5.4 覆盖排空超时、PTY 在排空期间退出、下一个事务不串入当前输出等边界

## 6. 验证与 OpenSpec 生命周期

- [x] 6.1 运行 Sharing、MCP、CommandExecutor、ShellProbe、Renderer 和 E2E 定向测试，修复回归
- [x] 6.2 运行 `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm verify`、`pnpm build` 和 `pnpm test:e2e`
- [x] 6.3 运行 OpenSpec strict 校验，核对明文命令、受限 preload、回环 MCP、无枚举和 Token 脱敏边界
- [x] 6.4 完成前复核 `git diff` 和工作树，确认不覆盖用户已有改动、不提交 `dist/`、`release/`、报告或凭据，并准备归档 Change
