## 1. 失败回归与运行时状态指导

- [x] 1.1 为 `ExternalToolPipeline.status()` 增加 `not_ready` guidance 失败测试，证明重复调用 status 不会写入 PTY 或触发 Probe
- [x] 1.2 为 `synapse_status` MCP tool description 增加只读与恢复流程断言
- [x] 1.3 将 `not_ready` guidance 改为提示外部客户端在远端提示符就绪后直接调用 `synapse_execute`，并说明执行前 Probe 与用户命令不写入边界

## 2. Share Text 恢复流程

- [x] 2.1 为 PowerShell 启动提示、SSH 到 POSIX 场景增加 Share Text 不循环调用 status 的失败测试
- [x] 2.2 更新 `buildShareText()` 的 `not_ready` 分支文案，保留原文 command、Probe 审计和 `synapse_wait` 顺序
- [x] 2.3 更新相关 Renderer/Playwright 断言，确保不引导外部客户端添加 wrapper、翻译或编码

## 3. 验证与 OpenSpec 生命周期

- [x] 3.1 运行 MCP、ShellProbe、CommandExecutor、Share Text 和 Renderer 定向测试
- [x] 3.2 运行 `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm verify`、`pnpm build` 和 `pnpm test:e2e`
- [x] 3.3 运行 OpenSpec strict 校验并复核 status 只读、明文 Probe 和用户命令审计边界
- [x] 3.4 复核 diff 与工作树，确认不覆盖用户已有改动、不提交 `dist/`、`release/`、报告或凭据，并归档 Change
