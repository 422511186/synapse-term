# 运行手册

本文档面向开发者、测试人员和本机维护者。命令以仓库根目录为当前工作目录；除特别说明外，Windows 使用 PowerShell，macOS 使用 bash/zsh。

## 环境约定

- Node.js：`>=24.12.0 <25`。
- pnpm：`10.28.1`，以根目录 `package.json` 为准。
- Electron：`electron-builder.yml` 当前固定 `43.2.0`。
- 用户数据目录：Windows `%APPDATA%\synapse-term`，macOS `~/Library/Application Support/synapse-term`。
- Core 数据目录：用户数据目录下的 `core/`。
- 安装产物目录：仓库根目录 `release/`，该目录不应作为源码提交。

项目仍保留 `terminal-agent` 作为旧数据迁移来源、内部 app id 和 `TERMINAL_AGENT_*` 环境变量前缀。不要因为这些兼容标识而重新使用旧产品名。

## 安装与启动

首次安装依赖：

```bash
corepack enable
pnpm install --frozen-lockfile
```

运行完整本地校验和构建：

```bash
pnpm verify
pnpm build
```

启动 Mock Renderer：

```bash
pnpm dev
```

启动真实 Electron：

```bash
pnpm start
```

真实桌面端依赖已经构建好的 `apps/desktop/dist` 和可用的 Electron 运行时。必要时运行：

```bash
node apps/desktop/node_modules/electron/install.js
```

## 创建 Session

1. 在工作区打开“新建终端会话”。
2. 填写名称并选择 Shell；工作目录由应用使用当前用户 home 初始化，不在创建对话框中让用户输入。
3. 等待 PTY 进入运行状态和 Shell 提示符可用状态。
4. 在终端中自行完成 SSH、跳板机、容器、WSL 或其他认证。
5. 根据当前 PTY 环境设置执行方言：POSIX、PowerShell 或仅观察。
6. 进入嵌套远端/容器环境后重新选择或验证方言。

方言决定命令事务如何被构造和确认，不代表远端主机类型。`observe_only` 只允许观察，不允许 Agent 或外部调用者执行结构化命令。

## 配置 Provider 和模型

1. 打开“Provider 管理”，填写协议、Base URL、API Key、headers 和超时并保存。
2. 打开“模型”，选择 Provider，点击“拉取模型”或手动填写模型 ID。
3. 设置上下文窗口、最大输出、自动压缩、压缩阈值和推理强度。
4. 保存后点击“检测模型”。
5. 检测状态为 `available` 后再启用模型，并按需设为默认。

Provider 的修改会使引用它的模型重新变为 `unverified`。详细字段、检测状态和错误处理见 [模型配置](model-configuration.md)。

## 使用内置 Agent

普通对话不会自动读取终端或文件，也不会取得 Session Lease。需要环境事实时，Agent 会显式请求：

- `terminal_observe`：观察屏幕或增量输出。
- `terminal_execute`：执行一条命令事务。
- `terminal_wait`：等待命令结果。
- `terminal_interrupt`：中断活动命令。
- Local File Tool：访问当前用户 home 内的受限文件路径。

权限模式：

- `manual`：变更、未知、特权和破坏性操作都需要审批。
- `auto`：普通变更自动执行，高风险操作仍需审批。
- `full_access`：不显示审批，但不扩大工具、Session、路径和 Schema 边界。

看到密码、OTP、host key、pager、编辑器、TUI 或交互确认时，停止 Agent 并进行用户接管。完成交互后重新观察，再把控制权交还给 Agent。

## 使用资源面板

资源刷新是一次性的显式操作，不是后台轮询。刷新前确认：

- Session 的 PTY 正在运行，Shell 已就绪。
- 当前没有活动 Command Transaction 或用户接管。
- 方言为 POSIX 或 PowerShell。

Core 会通过当前 Session 的固定只读命令收集 host、OS、uptime、CPU/负载、内存、swap、磁盘和网络。命令不可用时快照可以是 `partial` 或 `unavailable`，不会用估算值填充。

## 启用 MCP

1. 在设置中打开 MCP 集成。
2. 选择外部审批模式：`read_only` 或 `managed`。
3. 复制连接地址和 Bearer token；token 只在桌面设置中显示。
4. 在工作区将目标 Session 标记为共享，并复制该 Session ID。
5. 让 MCP 客户端连接本机地址的 `/mcp` 端点。

MCP 默认关闭，只监听 `127.0.0.1` 的随机端口。重新生成或吊销 token 会立即影响新请求。端点不提供 Session 枚举；调用者必须使用用户复制的 ID。

## 启用 ACP

1. 确认 `opencode` 已安装，并能从启动 Electron 的环境中找到。
2. 在 ACP 设置中打开“允许 ACP 集成”。
3. 选择 `managed` 或 `manual` 审批模式。
4. 返回工作区，在 Agent 面板选择 ACP 驱动者并开始任务。

应用会按当前 Session 的工作目录启动 `opencode acp --pure --cwd <cwd>`。ACP 子进程自主管理模型和上下文；平台只提供终端和只读文件能力。关闭 ACP 开关、关闭 Conversation 或退出应用会结束该子进程。

## 常见故障

### Core 未连接

1. 查看桌面端错误提示，确认 Node 和 Core 入口存在。
2. 确认用户数据目录可写，尤其是 `core/`、`auth.token` 和 `upgrade-state.ini`。
3. 使用 `TERMINAL_AGENT_DEBUG=1` 启动以查看桌面 Main/Core 的诊断输出。
4. 不要先删除 `core.sqlite`；保留数据库有助于迁移和审计。

### Shell 找不到

Shell 由 `@synapse-term/terminal-service` 动态发现。检查 Shell 是否仍安装、路径是否在 PATH/系统标准位置、创建对话框是否把它标为可用。应用不应依赖固定用户名、盘符或开发机路径。

### Agent 无法执行命令

依次检查：

1. Session PTY 是否为 `running`，Shell 是否为 `ready`。
2. 方言是否与当前 PTY 环境一致；`observe_only` 会明确拒绝执行。
3. 最近是否发生人工输入、接管或方言切换，导致旧 Lease epoch 失效。
4. 命令是否被判为 unknown、privileged 或 destructive，并等待审批。
5. 是否出现交互式提示；这时需要用户接管，而不是重复发送命令。

### 普通对话失败

确认模型同时满足 `enabled` 和 `available`，Provider 凭据仍存在，且 Provider 修改后已重新检测。查看 Agent 时间线中的稳定错误，不要把 API Key 或完整 Authorization header 粘贴到日志。

### 资源刷新失败

停止活动命令，退出交互提示，确认执行方言为 POSIX 或 PowerShell。`collection_timeout` 表示固定采集事务超时；`partial` 只表示部分指标不可用，不代表整个 Session 失败。

### Core 协议或认证失败

协议 major 不兼容时，使用与当前 Core 匹配的桌面端。认证失败时先退出桌面端和 Core，检查 `core/auth.token` 的当前用户权限，再重新启动；不要用第三方工具复制或上传该 token。

### 输出出现 history gap

Core 只保留有界原始输出。`historyGap` 表示请求游标早于保留窗口，UI 会使用最近快照恢复显示；缺失的原始输出不能当成完整审计记录。

## 升级、备份与恢复

升级前：

1. 完成或取消 Agent Turn 和活动命令。
2. 在 Core 操作菜单中选择“退出 Core”，确认所有 PTY 结束。
3. 备份用户数据目录，至少保留 `core/core.sqlite` 和 `core/backups/`。

SQLite schema 迁移会在迁移前生成备份和 SHA-256 manifest。数据库版本高于当前 Core 支持版本时拒绝启动，不会覆盖数据库。Core 崩溃、升级或系统重启后的旧 PTY 会标记为 `interrupted`，不会自动重连远端环境。

维护命令的形式为：

```text
core-maintenance verify-backup <manifest.json>
core-maintenance restore-backup <manifest.json> <core.sqlite>
```

恢复前必须退出 Core。`restore-backup` 会先检查 `upgrade-state.ini`，Core 仍运行时返回退出码 `3`；恢复成功后会在数据库旁保留 rollback 前的救援副本。安装包中的固定 Node Runtime 和 `dist/core-maintenance.mjs` 是推荐的维护入口。

## 本地打包

Windows：

```bash
pnpm package:win:dir
pnpm smoke:core-package
pnpm smoke:maintenance-package
pnpm package:win
```

macOS：

```bash
pnpm package:mac:dir
pnpm smoke:core-package
pnpm smoke:maintenance-package
pnpm package:mac
```

产物位于 `release/`。文件名由 `electron-builder.yml` 决定：`Terminal-Agent-<version>-<arch>-Setup.exe` 或 `Terminal-Agent-<version>-<arch>.dmg`。当前安装器关闭自动删除用户数据；卸载默认保留 `%APPDATA%\synapse-term` 或 macOS 对应目录。

Windows 安装生命周期检查：

```bash
pnpm test:installer
```

该脚本只应在 Windows 上运行，并会验证安装、活动 Core 阻断、升级状态、卸载和用户数据保留。

## 真实环境验收

真实 Provider、SSH 和外部模型验收默认跳过。只有在明确提供隔离数据目录、已保存模型配置和 SSH target 时才启用：

```powershell
$env:TERMINAL_AGENT_REAL_E2E = '1'
$env:TERMINAL_AGENT_SSH_TARGET = '<ssh-target>'
$env:TERMINAL_AGENT_REAL_USER_DATA_DIR = '<isolated-user-data>'
pnpm test:e2e
```

脚本只执行固定的远端只读命令，不能把 API Key、SSH 凭据或鉴权 header 写入输出。真实验收结果不应作为无凭据 CI 的必要条件。
