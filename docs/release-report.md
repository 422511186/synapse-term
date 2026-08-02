# Terminal Agent v0.2.0 归档就绪报告

日期：2026-07-30

OpenSpec change：`upgrade-terminal-agent-runtime-v2`

版本：`0.2.0`

## 交付范围

- 本机 Electron + React + xterm Terminal workspace，顶部多 Session 标签和可关闭右侧资源/Agent 面板
- 独立 Node.js 24.12 Core、Windows ConPTY、POSIX/PowerShell ShellDriver 和持续输出事务
- Session Conversation、Agent Turn、版本化系统提示词、上下文预算与持久压缩
- 四个 Terminal Tool、五个本机用户 home 文件 Tool、三种 Permission Mode 和结构化审计
- Provider Profile 1:N Model Configuration、`/v1/models` 拉取、模型检测和每 Turn 不可变选模快照
- OpenAI Responses、OpenAI-compatible Chat Completions 和 Anthropic Messages 官方 SDK Adapter
- 中文桌面、Markdown 时间线、系统/明亮/暗黑主题和显式只读 Session 资源快照
- SQLite schema v8（含 v7/v8 历史数据兼容迁移）、Credential Manager、迁移备份、维护 CLI 和 NSIS 升级阻断

## 自动化结果

| 验证 | 结果 |
| --- | --- |
| `pnpm format:check` | 通过 |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过，5 个 workspace project |
| `pnpm test` | 111 个文件、406 个测试通过 |
| Browser workspace Playwright | 25/25 通过，覆盖 1440x900、980x640、390x844、权限模式 history 竞态与 Agent 时间线滚动 |
| 完整 Playwright E2E | 28 通过、1 项真实环境测试按凭据条件跳过 |
| Real Electron Playwright | 1/1 通过，真实 Main -> Named Pipe -> Core -> ConPTY 与 reload replay |
| PowerShell ConPTY integration | 状态保持、对象输出、退出码、持续输出、Ctrl+C 全部通过 |
| Packaged Desktop Playwright | unpacked 与静默安装目录均为 2/2 通过，覆盖真实 Provider、Local File Tool、PowerShell/Git Bash ConPTY，以及 PowerShell/POSIX 三种 Permission Mode |
| `pnpm smoke:core-package` | protocol v2 handshake、PTY output、replay、exit 全部通过 |
| `pnpm smoke:maintenance-package` | v1 备份校验、v2 数据库回滚到 v1 通过 |
| OpenSpec strict | change 校验通过；`--all --strict` 6 项通过 |

Vitest 在 `maxWorkers: 2` 下完成。ContextBuilder 额外验证：完整 v2 安全系统提示和当前用户消息无法同时装入时，Core 以 `context_budget_exceeded` fail closed，不把用户消息静默裁成空字符串。

本轮完成性审计发现旧 PolicyEngine 始终使用 Bash 解析器，导致 PowerShell `Get-*`、`Set-*`、服务控制和递归删除统一退化为 `unknown`。修复后，TerminalToolGateway 在每次调用时读取当前 Session execution dialect；真实 packaged PowerShell ConPTY 已覆盖 `manual` 只读/变更、`auto` 变更/unknown/privileged/destructive、`full_access` destructive，并核对审批取消副作用和 SQLite 授权审计。证据见 `docs/evidence/powershell-permission-matrix.log`。

Tool 任务完成性复核经过单元、Core 集成、packaged 和真实模型验证：候选文本不进入 Timeline、SQLite 或复核模型上下文；复核缺少证据时继续现有 Tool Loop，确认后只发布一次完整、自包含的最终答复。真实 PowerShell 验收还发现并修复了对象格式化晚于事务完成标记的问题，`Get-Location` 现在能在 Tool Result 中返回当前目录。

## 真实模型与 SSH 证据

真实外部凭据不属于无凭据自动化门禁。2026-07-29 已保留以下显式验收证据：

- 用户保存的 OpenAI-compatible `mimo-v2.5-pro` 完成模型检测、无 Tool 普通中文对话、流式 Markdown、多轮 Tool Call/Result 和自包含完成性复核；`Get-Date` 与 `Get-Location` 均返回 `read_only`、exitCode 0 的确定证据。
- Electron Session 使用本机现有 SSH 配置进入 `example-host`，产品没有创建主机、SSH 或连接拓扑对象。
- `manual` Permission Mode 下恰好执行七条白名单只读命令；每条授权均为 `risk=read_only`、`requiresApproval=true`，由验收流程逐条批准后 exitCode 0，Approval 请求与批准各 7 次，本机写 Tool 计数为 0，未修改远端配置、文件或数据。
- Session Resource Snapshot 与只读命令交叉确认 CPU、内存、磁盘、网络、host、OS 和 uptime。
- 远端命令严格限定为 `uname -a`、`uptime`、`free -b`、`df -P`、`cat /proc/loadavg`、`cat /proc/meminfo`、`cat /proc/net/dev`。
- 完整日志：`docs/evidence/example-host-readonly-e2e.log`；视觉证据：`docs/evidence/example-host-readonly-1440x900.png`。
- 真实模型日志：`docs/evidence/real-agent-session.log`，不包含 API Key 或鉴权头。

复跑真实验收需要显式提供现有数据目录、Model Configuration ID 和 SSH target；脚本不读取或输出 API Key。

## 视觉证据

- `docs/evidence/desktop-1440x900.png`：桌面工作区、顶部 Session 标签和右侧资源/Agent 面板
- `docs/evidence/minimum-980x640.png`：紧凑桌面窗口无重叠和不可见控件
- `docs/evidence/mobile-390x844.png`：窄视口终端保持可用
- `docs/evidence/model-page-980x640.png`、`model-page-390x844.png`：独立模型页面
- `docs/evidence/provider-discovery-980x640.png`：模型配置页拉取与选择模型 ID
- `docs/evidence/example-host-readonly-1440x900.png`：真实 SSH 只读验收

Playwright 断言关闭右侧面板后终端占满工作区、不保留空白列；明亮主题的终端前景、ANSI white/brightWhite、光标和选区保持可读对比度。

## 安装包

| 属性 | 值 |
| --- | --- |
| 文件 | `release/Terminal-Agent-0.2.0-x64-Setup.exe` |
| 大小 | 134,932,778 bytes |
| SHA-256 | `8056DD5E95FD79758CAA37E6C36DDC23D0FB0091CD1EA87B5E542EB93F9C85CB` |
| Unpacked desktop SHA-256 | `FA7621D7550F63E5B6B1C19F35DAED4EA45BD2A682719A332C30DEC6203970C9` |
| Runtime Node | `24.12.0` |
| Node SHA-256 | `2FFE3ACC0458FDDE999F50D11809BBE7C9B7EF204DCF17094E325D26ACE101D8` |
| Core SHA-256 | `21BB2A8640886B5C9F35A2837CDE3CBE53AADF33A0D7CBDDB27C5DAA84488DE5` |
| Maintenance SHA-256 | `4B3473A5A649840C6C347A11B5421376EC35C4B4C513EEFE32474666DE66D690` |

安装生命周期验证：

- `pnpm test:installer` 可重复执行完整安装生命周期，并拒绝覆盖已有正式安装或活动 Core。
- 静默安装退出码 `0`，安装目录包含桌面程序、固定 Runtime、Core、维护入口和卸载器。
- 从安装目录启动的应用通过 packaged E2E 2/2，覆盖真实 Provider、Local File Tool、PowerShell/Git Bash ConPTY；PowerShell 权限矩阵验证 `manual | auto | full_access` 与 `read_only | mutating | unknown | privileged | destructive` 的审批和实际执行关系。
- `upgrade-state.ini` 为 `running=1`、2 个 Session、1 个 Agent Turn 时，静默安装退出码为 `32`；阻断目录没有应用文件。
- 静默卸载退出码 `0`，程序目录移除，`%APPDATA%\Terminal Agent` 用户数据目录保留。
- 迁移备份校验和回滚 smoke 通过，并保留回滚前救援数据库。

## 已知非阻断项

- 安装包和桌面主程序未配置 Authenticode 产品证书，签名状态为 `NotSigned`；固定 Node Runtime 自带有效签名。
- 尚未配置产品图标，electron-builder 使用默认 Electron 图标。
- Renderer 主 chunk 约 795 kB，构建有 chunk-size warning；当前启动、布局和交互验证通过。
- `node:sqlite` 仍为 experimental API，因此固定 Node 24.12 并由 repository、migration 和 maintenance tests 隔离。
- 真实外部 Provider 与 SSH 验收依赖用户已有凭据和网络，默认跳过，不应成为无凭据 CI 的隐式前提。

## 最终自查

- `git diff --check` 通过；临时交互诊断脚本已删除，正式 Session 1 runner、installer runner 和验收证据保留。
- 生产代码未发现开发者用户名、`C:/Users`、固定盘符或工作区绝对路径；命中的绝对文本仅为注册表根、协议 URL 和 Mock 故障路径。
- 敏感值扫描只命中 `packaged-integration-key` 与 `integration-test-key` 两个本地测试占位 Bearer 值，未发现外部 API Key 或 `sk-*` 凭据；真实模型日志只记录 Model Configuration ID、能力与脱敏结果。
- `openspec validate upgrade-terminal-agent-runtime-v2 --strict` 与 `openspec validate --all --strict` 均通过。
- 工作区变更由本 OpenSpec change、测试、发布报告、验证矩阵和 `docs/evidence` 证据关联，可按 Requirement 追溯。

## 归档结论

v2 delta Requirement 已映射到 `docs/verification-matrix.md`，代码、浏览器、Electron、packaged、installer、升级阻断、备份与回滚证据均已记录。OpenSpec tasks 已完成 `121/121`，change 已具备归档条件；本报告不代替代码签名或正式发布审批。
