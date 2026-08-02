## MODIFIED Requirements

### Requirement: Launch Profiles
系统 SHALL 支持由 executable、args、cwd、环境变量引用和初始尺寸组成的本地启动配置，且不得要求配置远程连接类型。受支持的本地 Shell 启动参数 MUST 遵循对应平台的用户环境初始化语义：macOS Zsh/Bash 与 Windows Git Bash MUST 以登录交互模式启动，Windows PowerShell MUST 不禁用用户 Profile，WSL MUST 保持发行版默认 Shell 的环境边界。

#### Scenario: Launch arbitrary local command
- **WHEN** 用户选择启动 `powershell.exe`、`wsl.exe` 或 `ssh.exe` 的配置
- **THEN** 系统按配置创建本地 PTY 且不创建 SSH、堡垒机或容器领域对象

#### Scenario: Launch a POSIX shell from the desktop
- **WHEN** 用户从 Finder、Explorer 或终端启动 macOS Zsh、macOS Bash 或 Windows Git Bash
- **THEN** 系统使用登录交互 Shell 参数创建 PTY，使用户登录初始化配置有机会设置 PATH 和其他用户环境

#### Scenario: Launch PowerShell with its user environment
- **WHEN** 用户从 Windows 桌面启动 PowerShell Session
- **THEN** 系统不得传入 `-NoProfile`，且 PowerShell 按默认规则加载可用的用户 Profile

#### Scenario: Launch WSL without crossing environment boundaries
- **WHEN** 用户从 Windows 桌面启动 WSL Session
- **THEN** 系统使用 WSL 默认用户 Shell 和发行版内部环境，不把 Windows 侧 CLI 路径作为 Linux PATH 的替代品
