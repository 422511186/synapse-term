## Why

从 Finder 或 Windows Explorer 启动桌面应用时，应用继承的是桌面进程环境，而不是用户当前终端已经初始化完成的环境。部分 Shell 又显式跳过用户启动配置，导致通过 Homebrew、nvm、npm 全局目录或用户 Profile 配置的 `codex`、`node` 等命令在应用内终端中不可发现；该问题需要在所有受支持的 Shell 上统一处理，而不能只针对 macOS Zsh 修补。

## What Changes

- 统一 macOS Zsh、macOS Bash 和 Windows Git Bash 的启动策略，使 GUI 启动的终端按用户登录终端的规则初始化 PATH。
- 保持 Windows PowerShell 的用户 Profile 加载行为，并补充其从桌面环境启动时的命令发现验证。
- 明确 Windows WSL 的环境边界，验证 WSL 内部 PATH 与用户默认 Shell 初始化，不把 Windows 侧安装的命令错误地当作 Linux 命令。
- 补充跨平台 Shell 参数、环境继承和命令发现的回归测试，覆盖从终端启动与从桌面启动两类环境来源。
- 保留现有 Core/PTY 环境注入、Session 生命周期和安全边界，不把远程 SSH、容器或 WSL 环境混入本地 Shell 发现逻辑。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `desktop-terminal`: 修改本地 Shell 启动配置，使桌面终端加载与平台对应的用户环境初始化规则，并验证可执行命令发现。
- `terminal-sessions`: 修改 Session 启动环境和 Shell capability 初始化的跨平台要求，确保 GUI 启动时仍能得到一致、可验证的本地环境。

## Impact

- 影响 `packages/terminal-service` 的 Shell 定位、Shell 参数和 PTY 启动测试。
- 影响桌面端 Session 创建时的环境继承与真实运行时验证。
- 影响 macOS、Windows Git Bash、Windows PowerShell 和 WSL 的打包/真实环境测试矩阵。
- 不新增外部依赖，不改变 Core IPC、Agent 权限、Lease 或命令审计协议。
