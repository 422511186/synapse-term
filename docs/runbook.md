# 运行手册

## 版本与平台约定

手册面向 Windows 与 macOS 两种平台，不写死特定版本、架构或平台专属路径。产品品牌统一为 Synapse Term；安装产物、应用包和用户数据目录仍沿用打包标识 `Terminal Agent`（见 `electron-builder.yml`），因此涉及真实文件名、目录和命令时保留该名称。

- 安装包按平台输出到 `release/`：Windows 为 `Terminal-Agent-<版本>-<架构>-Setup.exe`，macOS 为 `Terminal-Agent-<版本>-<架构>.dmg`。实际版本与架构以 `release/` 目录中的产物为准；命名规则见 `electron-builder.yml`，产品版本以 `package.json` 的 `version` 为唯一来源。
- 安装包内置固定版本的 Node.js Core Runtime，文档不重复版本号。开发环境要求见 `package.json` 的 `engines.node`；打包产物的实际 Runtime 版本见安装目录中 `resources/core/runtime-manifest.json`（macOS 为 `Contents/Resources/core/runtime-manifest.json`）。
- 用户数据目录随平台不同：Windows 为 `%APPDATA%\Terminal Agent`，macOS 为 `~/Library/Application Support/Terminal Agent`；下文统一简称“用户数据目录”。
- API Key 使用平台原生凭据存储：Windows Credential Manager、macOS Keychain；下文统一简称“平台凭据存储”。

## 安装与首次启动

从 `release/` 选择当前平台的最新安装包：

- Windows：运行 `Terminal-Agent-<版本>-<架构>-Setup.exe`，按向导选择当前用户安装目录。安装包包含 Electron 桌面端、固定 Node.js Core Runtime、维护 CLI 和卸载器。
- macOS：打开 `Terminal-Agent-<版本>-<架构>.dmg`，将 Terminal Agent.app 拖入“应用程序”。应用包内包含 Electron 桌面端、固定 Node.js Core Runtime 和维护 CLI。

首次启动后确认顶栏显示“Core 已连接”。应用数据默认位于用户数据目录；卸载默认保留该目录中的模型配置、审计和回滚备份。

开发启动（PowerShell 或 bash）：

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm build
pnpm --filter @terminal-agent/desktop start
```

## 创建和准备 Session

1. 点击顶栏“新建终端会话”。
2. 输入名称并选择可用 Shell。界面不要求填写 working directory；Session 自动从当前用户 home 启动。
3. 在终端中自行执行 SSH、堡垒机跳转、容器进入、WSL 或其他认证操作。
4. 根据当前终端环境设置执行方言：
   - PowerShell 本机环境选择 `PowerShell`。
   - Git Bash、Linux、macOS、WSL 或 SSH 到 POSIX 远端后选择 `POSIX`。
   - 不允许 Agent 执行结构化命令时选择 `仅观察`。
5. 确认当前 Shell 已出现可用提示符，再提交 Agent 目标。

Agent 不知道也不需要知道连接拓扑。方言只决定 Command Transaction 协议，不创建 SSH、堡垒机、容器或服务器对象。人工输入、接管或方言切换会使旧 capability epoch 失效，下一次 `terminal_execute` 自动重新 Probe。

## 配置 Provider 与模型

1. 打开顶层“模型”页面，切换到“Provider 连接”。
2. 新建 Provider，选择协议，填写 base URL、API Key、额外 headers 和超时后保存。API Key 留空保存会保留已有凭据。
3. 切换到“模型配置”，选择 Provider。点击“拉取模型”可从 Models API 获取模型 ID，也可以切换为手动输入。
4. 配置 Context Window、最大输出、自动压缩阈值、支持和默认推理强度后保存。
5. 点击“检测模型”。只有检测到连接、鉴权、具体模型、streaming 和指定 Tool Call 都可用时，状态才为 `available`。
6. 启用模型，并按需设为默认。Agent 下拉框只显示 enabled + available 的模型。

一个 Provider 可以对应多个 Model Configuration。修改 Provider 协议、地址、凭据、headers 或超时会使引用它的所有模型回到 `unverified`，需要重新检测。详细字段和错误说明见 [模型配置](model-configuration.md)。

## 使用 Agent

Agent composer 提供模型、推理强度和权限模式：

- 普通问答可以直接回复，不调用 Tool、不 Probe、不取得终端 Lease。
- 需要当前环境事实时，Agent 调用 `terminal_observe` 或本机只读文件 Tool。
- 需要命令时，Agent 调用 `terminal_execute`，命令持续运行时使用 `terminal_wait`，必要时用 `terminal_interrupt`。
- 本机文件 Tool 始终作用于本机当前用户 home；SSH 远端文件通过 Terminal Tool 处理。

时间线按稳定 item 聚合流式 Markdown，显示用户消息、模型回复、Tool 活动、审批、系统错误和最终状态。取消 Turn 只停止 Agent 调度；中断仍在运行的命令需要单独执行“中断”。

## 权限模式

- `人工审批`：普通修改、未知、高权限和破坏性操作均暂停确认。
- `自动审批`：普通修改自动执行；未知、敏感、高权限和破坏性操作仍确认。
- `完全权限`：不弹审批，但不会绕过 Tool、Session、home、Schema、哈希、Lease 或审计边界。

审批内容必须核对完整命令或文件 Diff、风险、影响、路径和哈希。拒绝后 Agent 可以尝试只读替代方案，但不能复用旧授权执行修改后的参数。

## 资源快照

点击资源面板的刷新按钮后，Core 在当前 Session 中执行固定只读命令。刷新要求：

- Session 正在运行且 UI 已连接
- 没有活动命令、密码提示、TUI 或用户接管冲突
- execution dialect 为 POSIX 或 PowerShell

资源面板展示可确认的 host、OS、uptime、CPU/负载、内存、swap、磁盘和网络。某个命令不可用时显示“部分不可用”，其他指标仍保留。资源面板不自动轮询，也不代表持久监控。

## 常见诊断流程

- 状态分析：先让 Agent 观察提示符，再只读检查 uptime、CPU、内存、磁盘、网络和服务状态。
- 日志排查：先限定服务与时间窗口；长输出使用 `terminal_wait` 增量读取，避免重复启动同一命令。
- 问题修复：先取得只读证据，再提交最小修改；执行后用独立命令验证，不以“命令已发送”代替成功证据。
- 交互流程：密码、OTP、host key、pager、编辑器、TUI 或安装器提示由用户接管；完成后重新观察再继续。

## 故障排查

### Session 创建失败：File not found

Shell 路径不再由 Renderer 写死。检查创建窗口中的 Shell 是否标记可用、解析来源是否正确，以及目标 executable 是否仍存在。Git Bash 可通过 PATH、Git 注册表或标准环境位置动态发现；不可用 Shell 不应提交给 Core。

### 普通对话无响应

打开时间线查看明确的 system error。确认已选择 enabled + available 的模型，Provider 凭据仍存在，且模型检测未因 Provider 修改失效。普通对话不会运行 ShellProbe，因此终端没有额外输出是正常行为。

### 模型检测无反馈或失败

界面会显示状态、checkedAt、attempt、streaming、Tool Call 和失败原因。重点检查：

- base URL 的 `http://` / `https://` 是否与服务一致
- API Key、额外 headers、代理和 TLS 证书
- 模型 ID 是否存在并允许当前凭据访问
- 兼容端点是否真正支持 streaming 和标准 Tool Call
- 超时是否覆盖本地慢模型首次加载

### Agent 只能观察

当前方言为 `observe_only`，或 ShellDriver Probe 未通过。确认当前终端实际环境后切换为 POSIX 或 PowerShell；如果刚完成人工输入或接管，下一次执行会自动重新 Probe。

### 资源刷新失败

确认没有活动命令或交互提示，方言与当前环境一致。`collection_timeout` 表示固定只读命令未在 30 秒内完成；`partial` 表示某些指标不可用但快照其余部分有效。

### Core protocol version is incompatible

旧 Core 仍在后台持有 Session。若要保留 Session，继续使用旧桌面端；准备升级时先结束 Session，在 Core actions 中选择“退出 Core”，再启动新版本。

### Core authentication failed

不要删除数据库。退出全部 Synapse Term/Core 进程，检查用户数据目录下 `core/auth.token` 的访问权限是否仅限当前用户（Windows 检查 ACL，macOS 检查 POSIX 文件权限），再重启桌面端。

### 输出历史缺口

`history_gap` 表示请求 sequence 已被有界日志截断。UI 使用最近终端快照恢复可见屏幕；缺失历史不能视为完整审计记录。

## 升级

升级会终止 Core 持有的 PTY，不能恢复正在运行的远程 Shell：

1. 完成或关闭活动 Session 和 Agent Turn。
2. 在 Core actions 中选择“退出 Core”。
3. Windows 运行新安装包，macOS 用新版替换“应用程序”中的应用。Windows 安装器会读取 `upgrade-state.ini`：若 Core 仍在运行，交互安装器显示 Session/Turn 数并允许 Retry 或 Cancel；静默安装返回错误码 32。
4. 新 Core 启动时检查 SQLite schema。数据库高于当前 Core 支持版本时拒绝启动，不覆盖数据。
5. 仅在 schema 迁移时创建版本化 SQLite 备份和 `.json` SHA-256 清单。

## 校验和回滚数据库

先退出 Core，再使用安装目录中的固定 Runtime。

Windows（PowerShell）：

```powershell
$core = '<install-dir>\resources\core'
$manifest = "$env:APPDATA\Terminal Agent\core\backups\<backup>.sqlite.json"
$database = "$env:APPDATA\Terminal Agent\core\core.sqlite"

& "$core\node.exe" "$core\dist\core-maintenance.mjs" verify-backup $manifest
& "$core\node.exe" "$core\dist\core-maintenance.mjs" restore-backup $manifest $database
```

macOS（bash）：

```bash
core="/Applications/Terminal Agent.app/Contents/Resources/core"
manifest="$HOME/Library/Application Support/Terminal Agent/core/backups/<backup>.sqlite.json"
database="$HOME/Library/Application Support/Terminal Agent/core/core.sqlite"

"$core/node" "$core/dist/core-maintenance.mjs" verify-backup "$manifest"
"$core/node" "$core/dist/core-maintenance.mjs" restore-backup "$manifest" "$database"
```

恢复成功会输出 `restoredSchemaVersion`，并在数据库旁保留 `.pre-rollback-<timestamp>.sqlite` 救援副本。维护 CLI 检测到对应 Core PID 仍存活时拒绝恢复。

## 卸载

Windows：通过“设置/控制面板”卸载或静默卸载，删除程序文件；macOS：将应用移到废纸篓。卸载默认保留用户数据目录。需要彻底删除本机数据时，应在确认不再需要 Provider 配置、审计和回滚备份后由用户单独处理；卸载不会替用户删除这些数据。
