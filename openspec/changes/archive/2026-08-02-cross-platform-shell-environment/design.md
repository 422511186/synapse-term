## Context

桌面端通过 Electron Main 启动 Core，再由 Core 创建本地 PTY。Session 创建请求携带 executable、args、cwd 和环境变量；Desktop Core Bridge 会把 Electron 进程继承的环境与请求环境合并后交给 Core。问题在于，GUI 进程启动时通常没有用户在 Terminal 中经过 Shell 初始化得到的完整 PATH，而部分 Shell 启动参数又显式跳过了用户配置文件。

当前 macOS Zsh 已在工作区改为登录交互模式，但 macOS Bash 和 Windows Git Bash 仍使用 `--noprofile --norc -i`；Windows PowerShell 默认加载 Profile，WSL 则必须保持 Linux 发行版自己的环境边界。该变更需要同时覆盖启动参数、环境继承语义和测试契约。

## Goals / Non-Goals

**Goals:**

- 让从 Finder、Explorer 或终端启动的本地 Shell 在可预期范围内发现用户配置的 `codex`、`node`、`npm`、Homebrew 或其他 PATH 命令。
- macOS Zsh/Bash 与 Windows Git Bash 按登录交互 Shell 规则加载用户初始化配置。
- Windows PowerShell 保持用户 Profile 加载，不因新增参数意外禁用 Profile。
- 验证 WSL 使用发行版内部 PATH，不把 Windows 侧命令路径伪装成 Linux 环境能力。
- 用单元测试和真实 PTY/打包 smoke 覆盖 Shell 参数、环境继承和跨平台边界。

**Non-Goals:**

- 不新增 Cmd.exe Shell 类型，也不改变现有 Shell Locator 的平台支持集合。
- 不修改 Agent 权限、Lease、命令审计、Core IPC 或远程 SSH/容器拓扑模型。
- 不保证任意用户配置文件中的别名、函数、TUI 或自定义启动程序都能被安全自动化执行。
- 不把 Windows 安装的 `codex` 自动注入 WSL，也不替用户安装或定位外部 CLI。

## Decisions

### 1. POSIX 本地 Shell 使用登录+交互模式

macOS Zsh、macOS Bash 和 Windows Git Bash 的默认启动参数统一表达为登录+交互 Shell。这样 PATH 由用户的登录初始化文件负责，行为更接近用户正常打开系统终端的方式；不再以 `--noprofile`/`--norc` 强制创建一个与用户终端不同的环境。

备选方案是继续使用干净 Shell，并单独执行一次隐藏的 `env` 探测来拼接 PATH。该方案需要处理 Profile 副作用、超时、编码、Shell 差异和环境来源追踪，复杂度更高，也容易让“终端中实际环境”和“应用注入环境”再次分叉，因此暂不采用。

### 2. PowerShell 保持默认 Profile 语义

Windows PowerShell 使用现有 `-NoLogo` 参数，不添加 `-NoProfile`。PowerShell Profile 是否存在以及 Profile 如何修改 `$env:Path` 由用户环境决定；应用只负责把桌面进程继承的环境完整传给 PTY。

### 3. WSL 保持发行版边界

WSL 继续通过 `wsl.exe` 默认启动用户的发行版 Shell，不强行追加 Bash 参数或把宿主 Windows PATH 当作 WSL PATH。测试将区分“Windows 侧命令发现”和“WSL 内部命令发现”，避免把两者混为同一个成功条件。

### 4. 环境继承仍由 Desktop Core Bridge 统一处理

Renderer 的 Session 启动配置继续只提供可选环境覆盖；Desktop Core Bridge 负责合并 Electron 进程环境，并设置终端所需的 `TERM` 默认值。Shell Locator 只描述 Shell 可执行文件和参数，不读取或修改用户 Profile 内容。

### 5. 以 Shell 描述符和真实启动链路分别测试

单元测试验证每个平台 Shell 的 executable、args 和 executionDialect；桌面桥接测试验证继承环境不会因空的 Session `env` 被丢弃；真实 PTY/打包 smoke 验证包内 Core 能启动并创建 Session。对 Windows 和 WSL 的平台专属测试使用 skip/fixture 隔离，避免在非目标系统上伪造成功。

## Risks / Trade-offs

- [用户 Profile 中存在耗时、交互提示或 `exec` 命令] → 登录 Shell 可能启动变慢、阻塞或改变 PTY 行为；保留现有 PTY 启动错误和 Session 可见失败状态，并在真实平台测试中覆盖常见初始化场景。
- [用户配置覆盖 PATH 或使用平台专属语法] → 命令发现结果可能与系统 Terminal 一致但不一定适合 Agent 结构化执行；环境 Probe 仍是 Agent 执行前的最终事实源。
- [Windows Explorer 持有旧环境] → 修改系统 PATH 后已运行的 Explorer/应用不会自动刷新；文档和验证步骤需要要求重启应用，必要时重启 Explorer 或重新登录。
- [WSL 与 Windows CLI 路径不同] → `codex` 可能只安装在其中一个环境；通过环境边界测试和明确错误信息区分，而不是跨环境复制 PATH。
- [Shell 参数变化影响启动噪声] → Profile 输出可能出现在 PTY 首屏；现有命令协议使用有界标记，不依赖固定欢迎词，仍需运行协议和真实 Session 回归测试。

## Migration Plan

1. 更新 Shell Locator 的 POSIX 启动参数和对应测试。
2. 补充 Desktop Core Bridge、Session 启动和平台边界测试。
3. 运行全量测试、类型检查、构建和可用平台的 dir/核心 smoke。
4. 若真实用户 Profile 导致启动失败，可回滚到上一版本的 Shell 参数；不会产生数据库或协议迁移。

## Open Questions

- 当前产品不提供 Cmd.exe 选项；如果未来需要支持 Cmd.exe，应作为独立能力设计其 Profile 和 PATH 语义，而不把它隐式并入本变更。
