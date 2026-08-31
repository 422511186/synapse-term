## 1. TDD 回归与 SessionActor 过滤

- [x] 1.1 增加环境识别 Probe 在隐藏设置下不进入本地 terminal UI、但仍进入协议链路的失败测试
- [x] 1.2 增加环境 Probe 命令/结果跨多个 PTY 数据块和控制字符分割的失败测试
- [x] 1.3 增加关闭隐藏后环境 Probe 可见、CommandExecutor/外部输出仍不含 Probe 噪声的回归测试

## 2. 实现与设置文案

- [x] 2.1 在 `SessionActor` 增加仅作用于本地 terminal UI 的环境 Probe 回显过滤器，识别 POSIX/PowerShell 合法结果并幂等清理
- [x] 2.2 让 `ShellProbe` 在固定明文 Probe 生命周期内注册/释放 UI 过滤状态，不改变 `pty_output` 和环境验证
- [x] 2.3 更新“通用”设置标签、安全说明、Renderer/Playwright 断言，明确覆盖所有自动 Probe

## 3. 验证与 OpenSpec 生命周期

- [x] 3.1 运行 SessionActor、ShellProbe、CommandExecutor、MCP 和 Renderer 定向测试
- [x] 3.2 运行 `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm verify`、`pnpm build` 和 `pnpm test:e2e`
- [x] 3.3 运行 OpenSpec strict 校验并复核明文 Probe、受限 preload、远程审计和协议输出边界
- [x] 3.4 复核 diff 与工作树，确认不覆盖用户已有改动、不提交 `dist/`、`release/`、报告或凭据，并归档 Change
