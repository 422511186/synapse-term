## 1. 回归测试

- [x] 1.1 在 `packages/terminal-service/src/shell/shell-locator.test.ts` 为 macOS Zsh/Bash、Windows Git Bash、PowerShell 和 WSL 增加平台对应的启动参数契约测试
- [x] 1.2 为 `apps/desktop/src/main/desktop-core-bridge.test.ts` 和相关 Session 启动测试补充继承环境、空环境覆盖和 `TERM` 默认值验证
- [x] 1.3 增加可用平台的真实 PTY/打包 smoke 验证，区分宿主 Windows PATH、Shell Profile 和 WSL 发行版 PATH

## 2. Shell 启动实现

- [x] 2.1 统一 macOS Zsh 与 Bash 为登录交互启动，确保 GUI 创建的 POSIX Session 有机会加载用户 PATH
- [x] 2.2 将 Windows Git Bash 从跳过 Profile 的启动方式调整为登录交互方式，同时保持 PowerShell Profile 和 WSL 发行版环境边界
- [x] 2.3 核对 Desktop Core Bridge 的继承环境合并逻辑，确保各平台空的 Session 环境不会覆盖或丢弃桌面进程环境

## 3. 验证与交付

- [x] 3.1 运行 Shell Locator、Desktop Core Bridge、Session 和相关 Agent 回归测试，修复跨平台参数变化引起的兼容问题
- [x] 3.2 运行 `pnpm verify`、`pnpm build` 和 `git diff --check`
- [x] 3.3 在可用 Node 版本下生成本地 macOS `dir` 包，并运行打包 Core/maintenance smoke；不执行 commit、push 或 release
