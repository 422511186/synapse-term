## 1. 先行锁定字面执行契约

- [x] 1.1 为 POSIX/Git Bash 与 PowerShell Shell Driver 增加失败单测：用户命令原文位于 PTY payload 的用户段首部，且实现不得自动添加 `eval`、Base64、变量承载、brace group 或 dot-source 包装
- [x] 1.2 为 Shell Driver 增加完成探针单测：POSIX 使用 `printf`，PowerShell 使用 `[Console]::Write`，探针独立于用户命令并携带 nonce
- [x] 1.3 为 `CommandExecutor` 增加 fake backend 失败回归测试：实际写入包含原始命令和独立探针，完成帧返回正确退出码，事务命令字段保持原文
- [x] 1.4 为 `SessionActor` 增加控制帧隔离失败测试：完整和跨 chunk 的 OSC 777 不得进入 `pty_output`，只产生结构化控制事件
- [x] 1.5 为不可审计输入增加失败测试：NUL、低位控制字符、伪造 OSC 777 和保留事务标记在 PTY 写入前返回 `COMMAND_NOT_AUDITABLE`

## 2. Shell Driver 与领域协议

- [x] 2.1 在公共领域协议中补充字面执行相关的传输标识、完成帧解析和稳定错误边界，保持领域层不依赖 Electron 或 PTY 实现
- [x] 2.2 实现 POSIX/Git Bash 字面命令 payload：原始命令只附加提交行尾，完成探针作为后续独立输入读取 `$?`
- [x] 2.3 实现 PowerShell 字面命令 payload：原始命令只附加提交行尾，完成探针按 `$?` 与 `$LASTEXITCODE` 语义读取退出状态
- [x] 2.4 实现 Shell Driver 的输入校验，拒绝会伪造控制帧或破坏事务边界的控制字符，并保留用户合法 Shell 语法原文

## 3. Main PTY 与 MCP 执行管线

- [x] 3.1 在 `SessionActor` 中加入可跨 PTY 回调的 OSC 777 流式扫描，分离 `pty_output` 和 `osc_777` 事件并保持普通输出顺序
- [x] 3.2 将 `CommandExecutor` 从旧 `wrapCommand` 路径切换到 Shell Driver 字面 payload，一次受控写入原始命令和独立完成探针
- [x] 3.3 让完成事件只由匹配当前事务 nonce 的结构化控制帧收敛，并确保完成探针不进入终端 UI、输出缓冲和 MCP 返回输出
- [x] 3.4 保持 `ExternalToolPipeline` 的原始命令风险分类、审批、会话内放行、租约、执行标记和脱敏边界不变，并映射 `COMMAND_NOT_AUDITABLE` 错误

## 4. 真实环境与 MCP 回归

- [x] 4.1 增加 Git Bash/ConPTY 集成测试，验证目标 PTY 输入直接包含用户命令、没有旧包装器，且 `false`、状态变更和 Unicode 输出行为正确
- [x] 4.2 增加 PowerShell/ConPTY 集成测试，验证 cmdlet/native command 的退出码、状态保持、中断和没有 `-EncodedCommand`/dot-source 包装
- [x] 4.3 更新 MCP 外部调用 E2E，验证审批卡片展示原始命令、执行标记展示原始命令、完成探针不污染终端，Git Bash 不直接执行 PowerShell cmdlet
- [x] 4.4 更新执行协议和 Share Text 相关说明，明确字面命令与独立完成探针的审计边界，不承诺目标机器完全没有辅助输入

## 5. 验证与收尾

- [x] 5.1 运行针对性 Terminal Service、Domain 和 Desktop MCP 测试，修复回归并确认新失败测试已变为绿色
- [x] 5.2 运行 `pnpm verify`，确认格式、ESLint、类型检查和 Vitest 全部通过
- [x] 5.3 运行 `pnpm test:e2e` 和可用的真实 Electron/ConPTY 场景，确认现有终端 Session、Sharing、审批和设置功能无回归
- [x] 5.4 运行 `git diff --check`、`openspec validate --change "literal-shell-audit-dispatch"` 并核对变更范围，保留用户已有未提交改动
