## ADDED Requirements

### Requirement: GUI Shell Environment Initialization
本地 PTY Session MUST 将桌面进程继承的环境与启动配置中的显式环境覆盖合并后传给 Shell，并由平台对应的 Shell 启动规则完成用户环境初始化。Session MUST 保留现有当前 PTY environment capability 验证作为 Agent 结构化执行前的最终事实源。

#### Scenario: macOS GUI session discovers user commands
- **WHEN** 应用从 Finder 启动并创建 macOS Zsh 或 Bash Session，且用户在登录 Shell 配置中声明了额外 PATH 目录
- **THEN** Session 内的 Shell MUST 能发现该 PATH 目录中的可执行命令，且 Agent Probe 依据当前 PTY 返回的 capability 决定是否允许结构化执行

#### Scenario: Windows desktop session inherits environment
- **WHEN** 应用从 Windows Explorer 启动并创建 Git Bash 或 PowerShell Session，且命令目录已经存在于桌面进程继承的用户环境或 Shell Profile 中
- **THEN** PTY MUST 接收该环境并能按对应 Shell 规则发现命令，不得因空的 Session 环境覆盖而丢失继承变量

#### Scenario: WSL keeps distro-local command discovery
- **WHEN** 应用创建 WSL Session 且 `codex` 只安装在 Windows PATH 或只安装在 WSL 发行版 PATH
- **THEN** 系统 MUST 只在实际运行环境包含该命令时报告发现成功，不得把另一侧环境的 PATH 当作成功依据

#### Scenario: Environment changes after application launch
- **WHEN** 用户在应用启动后修改系统或用户 PATH
- **THEN** 新建 Session MUST 使用应用当前可获得的环境；已存在的 PTY 不得被静默重写，用户需要重启应用或重新建立 Session 才能获得新的桌面环境
