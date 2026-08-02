# Synapse Term

Synapse Term 是一个本地优先的桌面终端与 Agent 工作台。它让用户先在终端中准备好本地 Shell、SSH、跳板机、容器或 WSL 环境，再让 Agent 在这个已经存在的 Terminal Session 中观察、执行和验证任务。

项目当前版本以根目录 `package.json` 为准，构建产品名为 Synapse Term。仓库提供 Windows x64 和 macOS arm64 的构建流水线；GitHub Release 由 `v*` 标签触发，发布动作不会在普通分支 push 时自动发生。当前部分旧 UI 文案仍显示 `Terminal Agent`，属于命名迁移遗留，不代表包名或构建产品名。

## 能力概览

- 本地 Electron 桌面端：React、xterm 和简体中文工作区。
- 独立 Node.js Core：持有 PTY、终端状态、命令事务、Agent 任务、模型配置、审计和 SQLite 数据。
- 内置 Agent：支持普通对话、流式模型响应、工具循环、审批、取消、用户接管和对话压缩。
- 三种模型协议：OpenAI Responses、OpenAI-compatible Chat Completions、Anthropic Messages。
- 九个固定内置工具：四个终端工具和五个本机文件工具，工具参数由 Core Schema 校验。
- 本机文件边界：文件工具只访问当前操作系统用户的 home，远端文件通过 Terminal Session 访问。
- 外部接入：桌面端内嵌 MCP HTTP 端点，以及以 `opencode acp --pure` 启动的 ACP 外部 Agent。
- 安全控制：命令风险分类、权限模式、精确审批、Session 租约、命令哈希、文件 SHA-256 和结构化审计。

Synapse Term 不建立服务器资产、SSH 拓扑或远程凭据模型。用户在终端里如何到达目标环境，不会改变 Agent 的能力边界。

## 快速开始

开发环境要求：

- Windows 或 macOS；CI 当前使用 Windows x64 和 macOS arm64。
- Node.js `>=24.12.0 <25`。
- pnpm `10.28.1`，以根目录 `package.json` 的 `packageManager` 为准。

安装依赖：

```bash
corepack enable
pnpm install --frozen-lockfile
```

浏览器 Mock UI 开发：

```bash
pnpm dev
```

`pnpm dev` 只启动带 Mock API 的 Renderer，适合 UI 开发；它不会启动真实 Electron、Core、Named Pipe 或 PTY。

启动真实桌面端：

```bash
pnpm build
pnpm start
```

如果本机尚未下载 Electron 运行时，可执行：

```bash
node apps/desktop/node_modules/electron/install.js
```

## 基本使用

1. 在工作区创建 Terminal Session，填写名称并选择系统发现到的 Shell。Session 默认从当前用户 home 启动。
2. 在终端里自行执行 `ssh`、多级跳转、`docker exec`、`kubectl exec`、WSL 或其他认证流程。
3. 根据当前终端环境选择 `POSIX`、`PowerShell` 或 `仅观察` 执行方言。进入 SSH 或容器后，如果环境发生变化，重新验证方言。
4. 在“Provider 管理”中创建模型服务连接，在“模型”中创建、检测并启用 Model Configuration。
5. 在 Agent 面板选择内置 Agent、模型、推理强度和权限模式，然后提交自然语言目标。
6. 资源面板只在用户点击刷新后，通过当前 Session 执行固定的只读采集命令，不是后台监控服务。

Agent 不会默认看到终端屏幕或本机文件；它需要通过工具显式获取事实。遇到密码、OTP、分页器、编辑器、TUI 或其他交互提示时，应由用户接管终端。

## 内置工具

内置 Agent 可见的工具固定为以下九个：

| 工具                 | 作用                                   |
| -------------------- | -------------------------------------- |
| `terminal_observe`   | 读取当前 Session 屏幕或增量输出        |
| `terminal_execute`   | 在当前 Session 中执行一条结构化命令    |
| `terminal_wait`      | 等待命令事务输出或最终状态             |
| `terminal_interrupt` | 中断当前命令事务                       |
| `local_list_files`   | 列出 home 内目录内容                   |
| `local_search_files` | 按文件名或内容搜索 home 内文件         |
| `local_read_file`    | 有界读取 home 内文本文件并返回 SHA-256 |
| `local_write_file`   | 创建文件或按 expected SHA-256 替换文件 |
| `local_edit_file`    | 按 expected SHA-256 执行精确文本编辑   |

工具 Schema、路径边界、审批和审计都在 Core 中执行。权限模式不会增加工具数量，也不会把本机文件根目录扩展到 home 之外。

## 模型配置

Provider Profile 只保存协议、Base URL、额外请求头、超时和凭据引用；Model Configuration 引用一个 Provider，保存具体模型 ID、上下文窗口、输出上限、压缩策略、推理强度、检测结果和启用状态。

支持的协议和配置流程见 [模型配置](docs/model-configuration.md)。API Key 只写入 Windows Credential Manager 或 macOS Keychain，数据库、Renderer、模型发现结果和审计中不会保存密钥值。

## MCP 与 ACP

### MCP

MCP Server 内嵌在桌面主进程中，默认关闭。启用后只监听本机 `127.0.0.1` 的随机端口和 `/mcp` 路径，并使用可吊销的 Bearer token。用户需要先在桌面中将 Session 标记为共享，外部客户端随后才能用用户复制的 `sessionId` 调用它。

MCP 当前暴露四个终端工具和三个只读本机文件工具：`terminal_execute`、`terminal_observe`、`terminal_wait`、`terminal_interrupt`、`local_list_files`、`local_search_files`、`local_read_file`。外部调用同样经过 Core 的租约、策略和审计管线。

### ACP

ACP 集成默认关闭。启用后，在 Agent 面板选择 ACP 驱动者并开始任务，桌面端才会启动本机 `opencode acp --pure --cwd <目录>` 子进程。当前实现只接入 `opencode`，外部进程自主管理模型和推理循环；平台只声明终端和只读文件能力，并将工具调用送入同一套 Core 策略。

使用 ACP 前，需确保 `opencode` 已安装且可从桌面进程的 PATH 找到，或通过应用启动环境提供可执行文件路径。Codex 等没有可用 ACP server 的客户端，应通过 MCP 接入。

## 常用命令

| 命令                             | 用途                                                 |
| -------------------------------- | ---------------------------------------------------- |
| `pnpm verify`                    | Prettier、ESLint、TypeScript 和 Vitest 全量校验      |
| `pnpm test`                      | 运行 `apps/` 与 `packages/` 下的单元、集成和协议测试 |
| `pnpm test:e2e`                  | 启动 Mock Renderer 并运行 Playwright 浏览器 E2E      |
| `pnpm build`                     | 构建 Core 和 Electron 主进程、preload、Renderer      |
| `pnpm package:win`               | 构建 Windows NSIS 安装包                             |
| `pnpm package:mac`               | 构建 macOS DMG                                       |
| `pnpm package:win:dir`           | 构建 Windows 解包目录，便于 Electron E2E             |
| `pnpm package:mac:dir`           | 构建 macOS 解包目录                                  |
| `pnpm smoke:core-package`        | 验证打包后的 Core Runtime                            |
| `pnpm smoke:maintenance-package` | 验证打包后的维护入口                                 |
| `pnpm test:installer`            | Windows 安装、升级阻断、卸载和数据保留验证           |
| `pnpm verify:real-agent`         | 使用显式配置运行真实模型验收，默认不启用             |

更完整的命令、升级、备份和故障处理见 [运行手册](docs/runbook.md)。

## 架构与数据

```text
Electron Renderer
        | 受限 preload API
        v
Electron Main
   |             |
   | Named Pipe  | 内嵌 MCP / ACP
   v             |
独立 Node.js Core <--- Core API
   |
Session、Agent、Provider、策略、审计、SQLite
```

Renderer 不直接持有 Node API、PTY、SQLite 或 Provider 密钥。Core 通过当前用户作用域的 Named Pipe 与桌面主进程连接，使用 challenge-response 和协议版本握手；当前协议版本为 `2.0`。

桌面用户数据目录默认是：

- Windows：`%APPDATA%\synapse-term`
- macOS：`~/Library/Application Support/synapse-term`

Core 数据位于其中的 `core/`，包含 `core.sqlite`、`raw-logs/`、`audit/`、`backups/`、`auth.token` 和 `upgrade-state.ini`。安装产物沿用 `Terminal-Agent-...` 文件名，`terminal-agent` 环境变量和旧数据目录只作为兼容接口保留，不代表当前产品名称。

## 文档

- [架构说明](docs/architecture.md)：进程、Package、Session、Agent 和数据流。
- [模型配置](docs/model-configuration.md)：Provider、模型发现、检测和上下文压缩。
- [安全边界](docs/security.md)：凭据、工具、审批、路径和审计约束。
- [运行手册](docs/runbook.md)：开发、安装、操作、升级和维护。
- [验证矩阵](docs/verification-matrix.md)：当前代码中的测试与 E2E 覆盖。
- [当前构建与发布状态](docs/release-report.md)：本地验证、CI 和 GitHub Release 触发条件。
- [架构决策记录](docs/adr/)：已编号的产品和技术决策。

## 许可证

本项目基于 MIT 许可证发布，详见 [LICENSE](LICENSE)。
