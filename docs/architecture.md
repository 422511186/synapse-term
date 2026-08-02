# 架构说明

本文档描述当前仓库中的 Synapse Term 实现，不把历史设计草案或未来产品方向当成已交付能力。

## 产品边界

Synapse Term 是单用户、本机运行的桌面应用。它的核心对象是由本机 Core 持有的 Terminal Session：PTY、终端状态、输入输出序列、屏幕模型和有限历史。它不是 SSH Session、服务器资产或远程凭据对象。

用户可以在一个 Terminal Session 中运行 SSH、跳板机、容器、WSL 或其他连接流程。Agent 只绑定用户选定的、已经存在且可执行的 Session；Core 不解析连接拓扑，也不保存远端认证信息。

当前代码分成两类入口：

- 内置 Agent 由 Core 中的 `AgentCoordinator` 驱动，模型和推理循环由平台管理。
- 外部调用由桌面主进程的 MCP 端点或 ACP 控制器接入，再翻译为 Core API 调用。外部调用携带调用者身份和共享 Session 标识，但不创建内置 Agent Task。

## 进程与边界

```text
React Renderer + xterm
        |
        | contextBridge / preload API
        v
Electron Main
  | CoreSupervisor + NamedPipeCoreConnector
  | EmbeddedMcpServer
  | AcpController -> opencode ACP 子进程
  v
Node.js Core
  CoreApplication -> CoreRequestRouter
  -> Session / Agent / Model / Policy / Audit / Store
```

| 组件           | 当前职责                                                | 不应直接持有                         |
| -------------- | ------------------------------------------------------- | ------------------------------------ |
| Renderer       | 工作区、xterm、Agent 时间线、模型设置、审批和资源视图   | Node API、PTY、SQLite、Provider 密钥 |
| Preload        | 暴露经过白名单限制的 `window.terminalAgent` API         | 任意 IPC 转发、文件系统和网络能力    |
| Electron Main  | BrowserWindow、Core 生命周期、Shell 发现、IPC、MCP、ACP | Agent 策略实现和数据库业务逻辑       |
| Core           | 终端、Agent、模型、工具策略、审计、SQLite、凭据存储     | 桌面 DOM、远程主机拓扑               |
| MCP Server     | 回环 HTTP、Bearer token、MCP 工具到 Core API 的翻译     | 绕过 Core 的执行或审批逻辑           |
| ACP Controller | 启动 `opencode`、ACP 会话、外部时间线和审批桥接         | 直接操作 PTY、Policy 或 SQLite       |

## Workspace Package

`apps/core` 已收敛为 Core 进程的装配入口；业务代码位于 workspace packages。各 package 的职责如下：

| Package                          | 职责                                                              |
| -------------------------------- | ----------------------------------------------------------------- |
| `@synapse-term/domain`           | Session、Agent、Provider、审批、命令事务和领域状态转换            |
| `@synapse-term/protocol`         | Zod Schema、Core API、IPC 握手、消息帧和跨层类型契约              |
| `@synapse-term/infrastructure`   | SQLite、Repository、迁移、备份、审计、路径、密钥存储、Named Pipe  |
| `@synapse-term/terminal-service` | PTY、SessionActor、ShellDriver、命令执行、输出重放和资源采集      |
| `@synapse-term/tooling`          | 本机 home 下的文件访问服务                                        |
| `@synapse-term/model-providers`  | Provider Profile、模型发现、模型校验和三种协议适配器              |
| `@synapse-term/agent-service`    | Agent Runtime、上下文构建、Token 预算和对话压缩                   |
| `@synapse-term/platform-kernel`  | Tool Gateway、授权策略、审批管理、外部调用管线和任务调度          |
| `@synapse-term/application`      | Core 用例路由、Agent 协调、Provider/Model/Session/资源/审计处理器 |
| `@synapse-term/ui-platform`      | Renderer 的 Terminal、Markdown、时间线、模型页和中文 UI 契约      |
| `@synapse-term/test-kit`         | Fake PTY、Fake Provider、时钟、临时目录和测试 Harness             |

Package 通过各自的 `src/index.ts` 公共出口互相引用；`packages/domain` 的依赖方向测试约束领域层不反向依赖基础设施和 UI。

## Core API 与 IPC

Core API 是桌面、MCP、ACP 共享的用例入口。当前用例覆盖：

- Session 创建、列表、关闭、方言切换、共享标记、终端写入、resize 和 replay。
- Agent 启动、取消、历史、重置对话、中断、审批和用户接管。
- Provider/Model 的列表、保存、发现、检测、启用、设为默认和删除。
- 资源快照、审计查询与清理、Core 状态和 Core 关闭。
- MCP/ACP 外部终端观察、执行、等待、中断、本机文件只读能力、命令分类和拒绝记录。

Electron Main 与 Core 通过当前用户作用域的 Named Pipe 通信。握手使用 `client_hello -> server_challenge -> client_authentication -> server_welcome`，认证证明由本地 `auth.token`、challenge、客户端实例、Core 实例和协议版本共同计算。当前协议版本为 `2.0`；major 不兼容时连接拒绝，minor 版本取双方较小值。

## Terminal Session

Session 的状态是多个维度的组合，而不是一个连接对象：

- PTY：`starting | running | exited | failed | interrupted`
- UI：`attached | detached`
- Shell：`unknown | probing | ready | executing | interaction_required`
- 执行方言：`posix | powershell | observe_only`
- Environment：平台和操作系统的探测结果、验证状态和 capability epoch
- Lease：用户、内置 Agent、MCP/ACP 外部调用者或无人持有

`SessionActor` 串行处理 PTY 输出、用户输入、Agent 输入、resize、租约和退出事件。输入控制权通过 epoch 保护：用户输入、接管、方言切换和环境重新探测会使旧的 Agent/外部调用租约失效。

Session 创建时由桌面端动态发现可用 Shell，并将当前用户 home 作为默认 cwd。创建流程不写死用户名、盘符、Git Bash、PowerShell、WSL 或系统组件绝对路径。

## 明文命令事务

Agent 和外部调用者不能直接向 PTY 写入任意包装脚本。`terminal_execute` 的流程是：

```text
Tool Schema
  -> Session / caller 绑定
  -> 环境与方言检查
  -> JIT Lease
  -> Policy / Approval
  -> PlaintextShellDispatcher
  -> ShellDriver 写入 PTY
  -> nonce 完成帧与退出状态
  -> Audit / Tool Result
```

POSIX 与 PowerShell 使用各自的 `ShellDriver`，但都以明文命令作为服务器可见的执行输入，并以 nonce、完成标记和退出码确认事务。`observe_only` 只允许观察，不允许结构化执行。命令包含控制字符、事务边界标记或伪造完成序列时 fail closed。

命令执行期间，同一 Session 最多有一个活动命令事务。检测到密码、OTP、分页器、编辑器、TUI 或其他交互程序时，事务进入 `interaction_required`，由用户接管；平台不提供通用的 Agent 按键注入工具。

## 内置 Agent

`AgentCoordinator` 将一次用户目标映射为一个 `AgentTurn`。`AgentRuntime` 可以在同一个 Turn 中进行多次模型运行：

```text
用户目标
  -> Provider Adapter 流式响应
  -> 文本响应：完成
  -> Tool Call：Schema -> 策略/审批 -> 执行 -> Tool Result
  -> 结构化历史 -> 下一次模型运行
```

普通文本对话不需要读取终端，也不会因为发送消息而自动取得 Session Lease。需要环境事实时，Agent 必须显式调用观察或文件工具。工具调用结果、审批、错误和最终回复以时间线投影到 Renderer，并写入结构化数据。

一个 Conversation 绑定一个 Session。每个 Turn 在启动时记录模型配置、Provider 配置、模型能力、上下文窗口、输出限制、压缩设置和推理强度快照；后续修改模型配置不会改写正在运行的 Turn。

`ContextBuilder` 默认只提供系统规则、对话历史、用户目标和最小 Session 元数据。`ConversationCompactor` 在达到 Model Configuration 的阈值后，为较早的结构化条目生成持久摘要，同时保留原始条目供历史和审计读取。

## Provider 与 Model

Provider Profile 与 Model Configuration 是两个独立实体：

- Provider Profile：协议、Base URL、额外请求头、超时和 Credential Manager 引用。
- Model Configuration：具体模型 ID、上下文窗口、最大输出、压缩阈值、推理强度、声明能力、启用/默认状态和检测结果。

当前协议适配器把 OpenAI Responses、OpenAI-compatible Chat Completions 和 Anthropic Messages 归一为文本增量、工具调用、用量、完成和错误事件。模型发现最多返回 500 条脱敏模型标识，发现结果必须经过保存、检测和启用后才会进入 Agent 可选列表。

## 外部接入

### MCP

MCP 由 Electron Main 内嵌，使用 Streamable HTTP，默认监听 `127.0.0.1`、随机端口和 `/mcp`。每个请求都校验最新 Bearer token；禁用或吊销 token 会停止端点或拒绝新请求。

用户必须显式将 Session 标记为 shared。MCP 端点不提供 Session 枚举；调用者使用用户复制的 `sessionId` 寻址。端点只把外部形态翻译为 `external.*` Core API，执行、审批、租约、脱敏和审计仍由 Core 完成。

### ACP

ACP 由 Electron Main 启动本机 CLI 子进程，目前默认是 `opencode acp --pure --cwd <cwd>`。一个平台 Session 对应一个长驻外部 Agent Conversation，用户显式开始 Turn 后才启动；关闭 Conversation、关闭 ACP 开关或退出应用会终止子进程。

平台只向 ACP 声明终端和只读文件能力。外部 Agent 的 permission request 经过平台策略：低危调用直接获得一次性许可，需要人工决定时复用内置审批卡片；未声明或不支持的工具被拒绝并审计。外部 Agent 的完整上下文由其进程管理，平台只保留 Conversation Projection。

## 持久化与生命周期

桌面端将 `userData` 固定到 `synapse-term`，Core 数据位于 `userData/core/`：

| 路径                | 用途                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `core.sqlite`       | Session、Conversation、Turn、Model Item、Tool Call、Command Transaction、审批、Provider、Model 和审计 |
| `raw-logs/`         | 有界、短期的原始终端输出                                                                              |
| `audit/`            | Core 数据布局预留的审计目录                                                                           |
| `backups/`          | SQLite 迁移产生的备份和 SHA-256 manifest                                                              |
| `auth.token`        | Named Pipe challenge-response 使用的本地认证令牌                                                      |
| `upgrade-state.ini` | Core PID、版本、Session/Agent 活动数量，供升级和维护命令判断                                          |
| `mcp/settings.json` | MCP 开关、审批模式和 Bearer token                                                                     |
| `acp/settings.json` | ACP 开关和审批模式                                                                                    |

当前数据库迁移版本为代码中 `CORE_MIGRATIONS` 的最高版本。打开旧数据库前会先备份；数据库 schema 高于当前 Core 支持版本时拒绝启动，不覆盖数据库。Core 崩溃、升级或系统重启不会恢复旧 PTY，恢复逻辑只把实时会话标为 `interrupted` 并保留历史和审计。

Core 支持 `keep_background` 和 `terminate_all` 两种关闭语义。桌面应用正常退出时使用 `terminate_all`；用户在 Core 操作菜单中可选择保留后台 Core。Core 在没有 Session、Agent Task 和客户端连接时可按空闲计时器退出。

## 兼容标识

产品名、workspace 包名和应用 ID 已统一为 `synapse-term`。以下标识仍由当前实现保留，用于兼容既有用户数据和自动化测试：

- `TERMINAL_AGENT_*` Core 启动环境变量。
- 旧的 `terminal-agent` userData 目录迁移来源。
- 安装包 `Terminal-Agent-...` 文件名和部分内部 IPC 标识。

这些兼容标识不是新的公开产品命名；修改它们需要同时设计迁移和协议兼容策略。
