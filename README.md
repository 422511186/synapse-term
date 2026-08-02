# Synapse Term

Synapse Term 是一个本机运行的桌面终端与自主 Agent（支持 Windows 与 macOS）。用户先创建 Terminal Session，并在终端中自行完成 SSH、堡垒机跳转、容器进入或其他认证；Agent 只操作这个已经准备好的 Session，不建模服务器、连接拓扑或远程凭据。

Agent 可以直接回答普通问题，也可以根据自然语言目标自主循环调用 Tool，持续观察输出、执行命令、等待结果、处理中间错误，直到完成、需要审批、需要用户接管、失败或取消。

## 安装与启动

安装包按平台输出到 `release/` 目录：

- Windows：`Terminal-Agent-<版本>-<架构>-Setup.exe`，运行后按向导选择当前用户安装目录。
- macOS：`Terminal-Agent-<版本>-<架构>.dmg`，打开后把 Terminal Agent.app 拖入“应用程序”。

安装后从开始菜单（Windows）或“应用程序”（macOS）启动 Synapse Term。文件名中的版本与架构以 `release/` 实际产物为准，命名规则见 `electron-builder.yml`。

开发环境要求：

- Windows 10/11 x64（支持 ConPTY）或 macOS arm64
- Node.js：版本以 `package.json` 的 `engines.node` 为准
- pnpm：版本以 `package.json` 的 `packageManager` 为准

```bash
corepack enable            # 或 npm i -g pnpm@<package.json 中 packageManager 的版本>
pnpm install
pnpm start                 # 触发 Electron 二进制懒下载，生成 dist/
```

安装依赖并首次启动后，可运行以下命令完成校验和构建：

```bash
pnpm verify
pnpm build
```

`pnpm dev` 只启动使用 Mock API 的浏览器界面，适合 UI 开发；真实 Electron、Named Pipe、Core 和 ConPTY 链路使用构建后的桌面端或 Playwright Electron 测试。

## 基本使用

1. 点击“新建终端会话”，只填写名称并选择系统动态发现到的 Shell。新 Session 自动从当前用户主目录启动，不需要填写 working directory。
2. 在终端中自行运行 `ssh`、多级跳转、`kubectl exec`、`docker exec`、WSL 或其他命令，进入目标环境。
3. 按终端当前环境选择执行方言：PowerShell、POSIX 或仅观察。例如从 PowerShell SSH 到 Linux 后，将方言切换为 POSIX。
4. 在“模型”页面先创建 Provider 连接，再创建、检测并启用 Model Configuration。
5. 在 Agent 输入框选择模型、推理强度和权限模式，输入自然语言目标。普通对话不强制调用 Tool；需要环境证据或副作用时，Agent 自主决定调用 Tool。
6. 资源面板只在用户点击刷新时，通过当前 Session 执行固定只读命令，展示 CPU、内存、磁盘、网络、主机、OS 和 uptime。

## Agent Tool

模型只能看到九个固定 Tool，参数中不包含 `sessionId`、Provider、模型或本机根目录：

| Tool                 | 能力                                         |
| -------------------- | -------------------------------------------- |
| `terminal_observe`   | 读取当前终端屏幕或增量输出，不取得输入 Lease |
| `terminal_execute`   | 在当前 Session 中执行一条结构化命令          |
| `terminal_wait`      | 等待活动命令的增量输出或最终状态             |
| `terminal_interrupt` | 中断当前 Turn 的活动命令事务                 |
| `local_list_files`   | 列出本机当前用户 home 内的文件               |
| `local_search_files` | 按文件名或文本搜索本机文件                   |
| `local_read_file`    | 有界读取本机文本文件并返回 SHA-256           |
| `local_write_file`   | 原子创建或替换本机文本文件                   |
| `local_edit_file`    | 按 expected SHA-256 原子执行精确文本编辑     |

Local File Tool 始终作用于运行 Synapse Term 的本机用户 home，与终端 cwd、SSH 目标或容器路径无关。远端文件必须通过当前 Terminal Session 处理。首版不提供删除、移动、权限修改、注册表或任意本机进程 Tool。

## 模型与上下文

Provider Profile 与 Model Configuration 相互独立：

- Provider Profile 保存协议、base URL、额外请求头、超时和 Credential Manager 引用。
- Model Configuration 引用一个 Provider，保存模型 ID、Context Window、最大输出、自动压缩阈值、推理强度、启用状态、默认状态和检测结果。
- 一个 Provider 可以复用给多个模型。Agent 只能选择已启用且检测状态为 `available` 的模型。
- 模型配置页可以通过 Models API 拉取不超过 500 个模型 ID，也始终允许手动输入自定义模型 ID。

支持协议：

- OpenAI Responses，官方 `openai` SDK
- OpenAI-compatible Chat Completions，自定义 base URL 和 headers，官方 `openai` SDK
- Anthropic Messages，官方 `@anthropic-ai/sdk`

长对话达到模型配置的压缩阈值后，Core 会生成持久化摘要并保留近期精确消息；原始 Conversation Item 不删除，仍用于历史与审计。详情见 [模型配置](docs/model-configuration.md)。

## 权限与安全

- `人工审批`：除确定只读观察外，修改、未知、高权限和破坏性操作都需要确认。
- `自动审批`：普通修改自动执行，未知、高权限、敏感和破坏性操作仍需确认。
- `完全权限`：不显示审批，但不会扩大 Tool allowlist、Session 绑定、本机 home、Schema、SecretRedactor、expected hash 或 Lease 边界。

API Key 只存入平台凭据存储（Windows Credential Manager / macOS Keychain），不进入 SQLite、Renderer 或审计 payload。所有 Agent Tool 调用、策略决定、审批、命令事务、文件前后哈希、接管和错误均记录结构化审计。

## 架构

```text
Electron Renderer (React + xterm + Markdown timeline)
        |
        | isolated preload API
        v
Electron Main
        |
        | authenticated, versioned Named Pipe
        v
Independent Node.js Core (pinned runtime)
  - ConPTY / SessionActor / ShellDriver / replay journal
  - AgentRuntime / ContextBuilder / ToolGateway / authorization
  - Provider Profile / Model Catalog / official SDK adapters
  - LocalFileService / resource snapshots / audit / SQLite
  - Platform credential store (Windows Credential Manager / macOS Keychain)
```

关闭桌面窗口只断开 UI，不主动终止 Core 持有的 Session。显式“退出 Core”才终止活动 PTY。Session 不承诺跨 Core 崩溃、Core 升级或系统重启存活。

## 验证与打包

```bash
pnpm verify
pnpm test:e2e
pnpm package:win:dir
pnpm smoke:core-package
pnpm smoke:maintenance-package
pnpm package:win
pnpm package:mac:dir      # macOS unpacked
pnpm package:mac          # macOS dmg
pnpm test:installer       # Windows 安装生命周期
```

详细说明见 [架构](docs/architecture.md)、[安全边界](docs/security.md)、[运行手册](docs/runbook.md)、[验证矩阵](docs/verification-matrix.md)。

## 许可证

本项目基于 MIT 许可证发布，详见 [LICENSE](LICENSE)。
