# 安全边界

Synapse Term 的安全目标是限制模型驱动的终端和本机文件操作，而不是替代远端服务器权限、SSH 密钥管理、操作系统隔离或企业策略中心。当前产品边界是单用户、本机运行；信任主体是当前操作系统用户。

## 信任模型

- 用户输入、远端 Shell 输出、本机文件和模型输出都视为不可信数据。
- 远端环境可能是 SSH、跳板机、容器、WSL 或本地 Shell；Core 不根据连接拓扑提升权限。
- 模型不能通过自然语言、风险标签或工具参数修改 Core 的工具集合、Session 绑定、home 根目录和策略。
- 用户仍可以绕过 Agent 直接在终端或文件系统中操作；产品只约束 Agent 和外部调用者经过平台的路径。

## 进程与凭据隔离

- Renderer 使用 sandbox、context isolation，关闭 Node integration；preload 只暴露白名单 API。
- Renderer 不直接接触 PTY、SQLite、文件系统、Provider API Key 或 Named Pipe。
- Electron Main 负责 BrowserWindow、窄 IPC、Core 子进程、MCP 和 ACP 生命周期。
- Core Named Pipe 使用当前用户作用域的端点、随机 auth token、challenge-response 和协议版本协商。
- Core 数据目录、原始日志、审计目录和认证 token 由当前用户权限保护；Windows 使用 ACL，POSIX 使用 `0700/0600` 权限。
- Provider API Key 只存储在 Windows Credential Manager 或 macOS Keychain；数据库只保存 credential reference。

## 工具边界

内置 Agent 的工具清单固定在 `packages/protocol/src/schemas/tool-schemas.ts`：四个终端工具和五个本机文件工具。工具调用必须经过 Core 的 `ToolGateway`，外部 MCP/ACP 调用必须经过 `ExternalToolPipeline`。

### Terminal Tool

`terminal_execute` 写入当前 Session 前按顺序执行 Schema 校验、Session/Task 或外部调用者绑定、环境 Probe、JIT Lease、风险分类、权限决策和审批。一个 Session 同时最多处理一个活动 Command Transaction。

命令风险分为：

| 风险          | 说明                             |
| ------------- | -------------------------------- |
| `read_only`   | 规则能够证明是只读观察           |
| `mutating`    | 普通修改或其他副作用             |
| `unknown`     | 解析失败、语义不清或无法证明安全 |
| `privileged`  | 提权、敏感配置或高权限操作       |
| `destructive` | 删除、覆盖、大范围或高影响操作   |

模型提供的风险标签只能作为输入参考，不能降低 Core 的分类结果。审批绑定 Conversation、Turn、Tool Call、Session、完整命令、风险和命令哈希；命令文本、顺序、目标 Session 或 Lease epoch 改变后，旧授权失效。

命令必须以明文进入 PTY，ShellDriver 用 nonce 和完成事件确认结果。包含控制字符、事务边界标记、伪造完成序列或无法建立可审计明文事务时拒绝执行。密码、OTP、pager、编辑器和 TUI 由用户接管，平台不向 Agent 提供通用 `send_keys`。

### Local File Tool

本机文件服务的根目录由运行时动态解析为当前用户 home，只接受相对路径。绝对路径、UNC、设备路径、ADS、NUL、`..`、symlink、junction 和 reparse point 逃逸全部 fail closed。

读取、列出和搜索属于只读能力；创建、替换和编辑属于写能力。`local_write_file` 的 replace 和 `local_edit_file` 要求 expected SHA-256，结果先在内存中构造，再通过同目录临时文件原子替换。返回的变化记录包含相对路径、操作、前后哈希、字节数和有界 Diff。

首版没有本机 delete、move、chmod、注册表或任意进程工具。`.ssh`、`.aws`、`.azure`、`.kube`、`.env*`、浏览器 Profile、私钥、Token 和密码等敏感路径或内容会提升风险或进入脱敏流程。

## 权限模式

内置 Agent 的 Conversation 权限模式为：

| 模式          | `read_only` | `mutating`     | `unknown / privileged / destructive` |
| ------------- | ----------- | -------------- | ------------------------------------ |
| `manual`      | 自动执行    | 审批           | 审批                                 |
| `auto`        | 自动执行    | 自动执行并审计 | 审批                                 |
| `full_access` | 自动执行    | 自动执行并审计 | 自动执行并记录高风险                 |

`full_access` 只影响是否显示审批，不扩大工具、Session、home、Schema、SecretRedactor、expected hash、Lease 或审计边界。切换权限模式不会自动批准已经等待中的审批。

MCP 使用独立的 `read_only` / `managed` 设置：`read_only` 拒绝写操作，`managed` 允许低危操作并拒绝高危操作。ACP 使用 `managed` / `manual` 设置；需要人工决定时复用同一张审批卡片，批准只授予当前命令一次执行权。

## 秘密与上下文

- 新 Turn 默认不包含终端屏幕、本机文件或远端输出；模型必须显式调用工具。
- Protected Input 不进入模型上下文、输出日志和审计载荷。
- 终端输出和文件内容在发送给模型、外部调用者或长期审计前经过 `SecretRedactor`。
- 默认检测器覆盖私钥块、Bearer token 和常见 `api_key/token/password/secret` 赋值形式；检测器失败时整体替换为安全占位符。
- 本地终端显示和用户明确批准的文件 Diff 可以保留原始内容，但不应把它们复制到 issue、日志或 Release 资产中。
- Provider 流出现首个事件后不做隐式重试，避免重复工具调用或副作用。

## MCP 与 ACP 接入安全

MCP 默认关闭，只监听 `127.0.0.1` 的随机端口。每个请求都需要最新 Bearer token，token 可重新生成和吊销；未标记为 shared 的 Session、无效 Session ID 和非 MCP 路径不会暴露其他会话信息。

ACP 子进程使用 stdio 与平台通信。当前只声明终端和只读文件能力；未声明的工具直接拒绝并审计。ACP 外部 Agent 没有直接访问 PTY、Policy、SQLite 或平台密钥的路径。

## 资源快照

资源面板必须由用户显式刷新，并且只在当前 Session 就绪、空闲、非交互、方言为 POSIX 或 PowerShell 时执行固定只读命令。模型不能提交自定义资源采集命令。采集结果保存结构化指标和状态；命令不可用时返回 `partial` 或 `unavailable`，不伪造零值。

## 审计与保留

结构化审计记录 actor、Session、Conversation、Turn、Tool Call、权限模式、策略结论、审批、命令哈希、文件前后 SHA-256、资源刷新、中断、接管、时间、退出状态和错误。完整终端字节流不是长期审计格式。

默认保留策略由 `RetentionManager` 控制：原始终端日志 24 小时，结构化审计 30 天。实现可以通过构造参数覆盖这些时长；清理不会修改 Provider 凭据或核心 SQLite 结构。

## 残余风险与限制

- Core 崩溃、升级或系统重启会终止旧 PTY，不承诺恢复正在运行的远程 Shell。
- 秘密检测可能漏报或误报，不能替代远端最小权限和凭据轮换。
- 未配置代码签名证书时，Windows 安装包可能显示未签名警告。
- MCP/ACP 是本机外部接入面；启用前应核对 token、共享 Session 和审批模式。
- `TERMINAL_AGENT_*` 是兼容环境变量，不应把其中的数据目录或 token 传给第三方脚本。
