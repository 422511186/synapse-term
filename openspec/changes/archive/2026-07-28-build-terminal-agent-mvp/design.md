## Context

项目为绿地 Windows 单用户桌面应用。用户通过本机终端自行进入 SSH、堡垒机、容器或其他远程环境，Agent 仅在用户显式选择的已就绪终端 Session 中工作。远程环境不安装 Agent、不启动持久辅助服务，也不要求 Terminal Core 理解连接拓扑。

系统的核心难点不是生成 Shell 文本，而是在一个长期存活、无结构的 PTY 字节流中建立可靠的命令边界、控制权、持续输出、退出状态、安全授权和审计语义。MVP 由一名 TypeScript 开发者在约 8 至 12 周内交付，目标平台为 Windows，结构化执行目标为 POSIX Shell。

## Goals / Non-Goals

**Goals:**

- 提供可日常使用的 Windows 桌面终端基础能力和多 Session 管理。
- 让独立本机 Core 持有 ConPTY、Agent Task、策略、凭据和审计，使 Session 跨 UI 关闭或重启存活。
- 让 Agent 根据自然语言目标，通过受控 Terminal Tool 在一个已就绪 Session 内连续执行命令并观察结果。
- 对普通命令提供实时输出、明确完成状态、退出码、等待、显式中断和人工接管。
- 对模型、命令、敏感数据和用户授权建立可机械执行的安全边界。
- 支持 OpenAI Responses、OpenAI-compatible Chat Completions 和 Anthropic Messages 自定义 Provider Profile。
- 建立可测试、可追溯、可按 OpenSpec change 持续演进和归档的工程基线。

**Non-Goals:**

- 不建模 SSH、堡垒机、Docker、Kubernetes 或远程服务器连接对象。
- 不在远端安装 Agent、上传持久脚本或依赖远端守护进程。
- 不让 Agent 自主操纵 `vim`、`top` 等完整 TUI，也不向 Agent 提供任意按键 Tool。
- 不保证 Session 跨 Terminal Core 崩溃、Core 升级或 Windows 重启存活。
- 不在 MVP 中开放外部 MCP Server、插件工具、本机文件工具或浏览器工具。
- 不建设产品账号、团队空间、集中策略、组织审计或计费服务。
- 不支持 PowerShell 的结构化 Agent 执行；PowerShell 仍可作为普通人工终端使用。
- 不防御用户已连接 Shell 本身恶意伪造输出、别名或控制序列；Ready Session 的 Shell 环境属于用户信任边界。

## Decisions

### Process Architecture and Trust Boundaries

采用独立 Core 与薄 UI：

```text
Electron Renderer (sandboxed)
        |
Electron Main / Preload bridge
        | Windows Named Pipe
terminal-core (independent Node.js runtime)
        +-- Session actors / node-pty
        +-- Agent runtime / policy
        +-- Provider adapters
        +-- SQLite / journals / keyring
```

Electron Renderer 开启 `sandbox` 和 `contextIsolation`，关闭 `nodeIntegration`。Renderer 只能调用 preload 暴露的窄接口；PTY、模型密钥、文件路径和 Named Pipe 句柄不进入 Renderer。

Core 是当前 Windows 用户下的单实例后台进程，不使用高权限 Windows Service。关闭窗口仅分离 UI；有活动 Session 或 Agent Task 时 Core 保持运行。显式退出时 UI 提供保持后台或终止全部选项，最后一个 Session 结束后 Core 可延迟退出。

备选 Electron 单体被否决，因为 Electron Main 崩溃或重启会同时终止所有 PTY；Go、Rust 和 .NET Core 被否决，因为团队主语言为 TypeScript，额外语言并未抵消终端生态和维护成本。

### Repository and Runtime Stack

使用 pnpm workspace 管理 TypeScript monorepo，不引入额外任务编排框架。建议目录：

```text
apps/desktop       Electron + React + @xterm/xterm
apps/core          Node.js Core + node-pty + @xterm/headless
packages/domain    领域状态、策略接口和纯函数
packages/protocol  IPC、Tool、Provider 归一化 Schema
packages/test-kit  PTY、Provider 和时钟测试替身
```

测试使用 Vitest，Electron 端到端测试使用 Playwright。Core 固定使用独立 Node.js 24.12 Runtime，由安装包作为资源分发；不复用 Electron 的 Node ABI。`node-pty` 和 keyring 原生模块必须在首个 Packaging Spike 中验证。

### Local IPC

Electron Main 与 Core 通过 Windows Named Pipe 通信。协议采用长度前缀二进制帧，区分 request、response、event 和 terminal-output frame；控制负载由共享 Zod Schema 校验，终端输出使用二进制 payload 避免 JSON 膨胀。

握手包含协议版本、Core 实例 ID、随机 challenge 和每用户认证令牌。Pipe 使用当前用户安全描述符，名称包含应用 ID 和用户作用域。协议版本不兼容时 UI 不自动重启正在持有 Session 的旧 Core，而是提示用户结束 Session 后升级。

所有事件携带单调递增 sequence。UI 重连时提交最后确认 sequence，Core 返回增量或快照。慢客户端拥有独立游标，不得阻塞 PTY ingestion。

### Session Domain Model

Terminal Session 是本地 PTY 上下文，不是 SSH Session、服务器连接、UI 标签页或 Agent 对话。Session 状态拆成正交维度：

- PTY：`starting | running | exited | failed | interrupted`
- UI：`attached | detached`
- Lease：`user | agent(taskId) | none`
- Shell：`unknown | probing | ready | executing | interaction_required`

每个 Session 由单一 `SessionActor` 串行处理用户输入、Agent 输入、resize、PTY 输出、租约变化和进程退出。Lease 包含递增 epoch；用户接管时 epoch 增加，使所有旧 Agent 写入令牌立即失效。

Session 启动配置仅包含本地 executable、args、cwd、环境变量引用和初始终端尺寸。配置可以启动 PowerShell、WSL 或 `ssh.exe`，但 Core 不派生远程连接领域对象。

默认资源限制为最多 20 个活动 Session、每个 Session 一个活动 Agent Task、全局最多 4 个运行中的 Agent Task。限制可配置，但 Core 必须始终执行硬上限和背压。

### Terminal State, Output Journal, and Reconnect

PTY 输出由 SessionActor 分配 sequence，然后进入有界内存队列、`@xterm/headless` 和异步 OutputJournal。UI 和 Agent 消费独立事件流，磁盘或模型消费者不能反向阻塞 PTY。

Core 使用 `@xterm/addon-serialize` 生成可重放的终端快照。UI 重连时：

- 请求 sequence 仍在日志中时补发增量。
- 日志已截断时发送最近快照和其后的增量，并产生 `history_gap`。
- Core 曾重启时旧 Session 标记 `interrupted`，不伪装连接仍存活。

默认 headless scrollback 为 10,000 行，活动 Session 原始日志上限为每 Session 64 MiB、全局 1 GiB。Session 结束后原始日志默认保留 24 小时，结构化审计默认保留 30 天；均可配置。原始日志存放在当前用户应用数据目录并继承用户 ACL，MVP 不额外进行逐块加密。

### Agent Runtime and Tool Boundary

AgentRuntime 使用自研小型状态机，Provider SDK 仅存在于边缘 Adapter。Agent Task 创建时绑定一个 Session 和一个 Provider Profile，模型不能在 Tool 参数中指定或切换 Session。

MVP Tool 只有：

- `terminal.observe`
- `terminal.execute`
- `terminal.wait`
- `terminal.interrupt`

不提供任意 `send_keys`、本机文件、进程、浏览器或插件 Tool。模型 Tool 参数由 Zod 校验，未知字段和无效状态调用直接拒绝。模型可能一次返回多个 Tool Call，但同一 Session 中必须按模型顺序串行执行；Provider 的 parallel tool call 能力不能绕过 Session 单事务限制。

Agent 仅在用户显式唤起后获得当前屏幕、有限回滚记录和本任务历史。ContextBuilder 发送脱敏后的结构化摘要，不在每轮重复完整终端记录。大输出返回首尾片段、总长度和 output cursor，Agent 通过 `terminal.wait` 或游标读取继续观察。

外部 MCP 不作为内部总线。未来若开放 MCP，Adapter 必须复用 ToolGateway 和 PolicyEngine；PTY 高频输出继续走独立事件订阅，而不是单次 MCP Tool 响应。

### Command Transaction Protocol

一个 Session 同时最多有一个活动 Command Transaction。状态为：

```text
draft -> policy_checked -> waiting_approval? -> lease_acquired
      -> dispatched -> running
      -> completed | interaction_required | interrupted
         | shell_lost | protocol_error
```

用户首次启用 Agent、人工输入或 User Takeover 后，Core 运行无落盘 `ShellProbe`，验证 POSIX `printf`、`eval` 和私有 OSC 事件。Probe 成功后记录 shell capability epoch；任何人工输入使 epoch 失效。

命令使用经过性质测试的 POSIX 单引号编码置入当前 Shell 顶层 `eval`，以保持 `cd` 和 `export` 等状态。完成时 Shell 发送私有 OSC 777 控制帧，包含 transaction nonce 和退出码。Core 使用 xterm OSC Handler 捕获事件；无法捕获时不得推断成功。

`observationWindow` 只决定何时向 Agent 返回 `running`，不终止命令。`hardDeadline` 只产生告警，默认不自动 Ctrl+C。取消 Agent Task 与中断命令是两个独立动作；`terminal.interrupt` 受策略控制。

`exit`、`exec`、`set -e`、trap、Shell 退出或网络断开可能阻止完成帧。此时综合 PTY 状态、prompt 信号、alternate screen 和交互特征给出 `shell_lost`、`interaction_required` 或 `protocol_error`，绝不把不确定状态标记为成功。

### Interaction Handoff

检测到密码提示、安装确认、pager、editor、alternate screen 或复杂光标控制时，Agent 停止输入并进入 User Takeover。Session Lease 转交用户，Protected Input 不进入 Agent 上下文、原始输入日志或审计 payload。用户完成操作后必须重新 ShellProbe 才能恢复 Agent。

MVP 不实现 Agent 驱动完整 TUI。简单 `yes/no` 也按交互处理，避免模型在未知上下文中自动确认破坏性动作。

### Model Providers

Provider Profile 包含协议、base URL、模型名、凭据引用、额外请求头、超时和声明能力，不包含密钥明文。支持：

- 官方 `openai` SDK 的 Responses API。
- 官方 `openai` SDK 的 OpenAI-compatible Chat Completions。
- 官方 `@anthropic-ai/sdk` 的 Anthropic Messages。

Adapter 将三者归一化为 text delta、tool call started/delta/completed、usage、turn completed 和 provider error。SDK 类型不得越过 Adapter。流开始后禁用隐式重试；在首个事件前仅允许有界、可审计的网络重试。

Provider Profile 保存前执行连接和能力探测。自定义端点声明不等同于实际能力，Responses、streaming 和 tool calls 分别验证。API Key 使用 `@napi-rs/keyring` 存入 Windows Credential Manager。

### Safety Policy and Approvals

PolicyEngine 使用 `web-tree-sitter` 与 `@vscode/tree-sitter-wasm` 提供的 Bash WASM grammar 解析命令。语法错误、未知节点、输出重定向、提权、alias/function 覆盖、危险参数或无法证明安全的命令均分类为 unknown 或更高风险。

风险层级：

- `read_only`：只有命中保守命令和参数规则时自动执行。
- `unknown`：必须展示精确命令并确认。
- `mutating`：必须展示精确命令、目的和影响并确认。
- `privileged`：增加提权警告，密码由用户接管输入。
- `destructive`：逐条确认并执行二次确认，不允许批量授权。

Approval Grant 绑定 Session、顺序、完整命令文本、风险元数据和哈希。编辑、插入、重排或切换 Session 立即使授权失效。模型风险标签仅作提示，不能成为授权依据。

威胁模型聚焦防止模型误操作、跨 Session 写入、凭据泄露和 UI 绕过策略；不声称抵御用户已信任远程 Shell 的恶意行为。

### Secret Protection and Audit

密码或其他 Protected Input 永不发送给模型，也不记录按键。输出进入模型或长期审计前经过可配置 secret detectors；自动脱敏 fail-closed 于模型披露，但不修改用户本地终端显示。

结构化审计使用 Node 24.12 固定 Runtime 的 `node:sqlite` WAL 数据库，至少记录 actor、Session、Agent Task、Tool Call、原始命令哈希、风险结果、授权、时间、退出状态和错误。`node:sqlite` 被封装在仓储适配器内，以隔离其 experimental API；审计事件追加写入，不把完整终端录像当作长期审计。

Provider 密钥仅存 Credential Manager；SQLite 只存不可逆 credential reference。日志和数据库目录限制为当前 Windows 用户访问。

### Desktop Experience

桌面端 MVP 提供标签页、启动配置、复制粘贴、搜索、滚动区、窗口 resize、Session 状态、Agent Task 时间线、命令审批和人工接管。暂不实现分屏、主题市场、插件、命令块编辑器或完整快捷键定制。

Agent 面板属于当前 Session，不能跨标签页隐式迁移任务。高危确认显示 Session 标签和完整命令。UI 断开时当前命令继续到自然结束，随后 Task 自动 suspended；重连后由用户显式恢复。

### Error Handling and Recovery

- Provider 在 Tool Call 完整解析前失败：不执行任何命令，Task 可重试或失败。
- Provider 在命令开始后失败：本地命令继续，完成后 Task suspended。
- UI 断开：当前命令继续，之后暂停。
- Pipe 断开：UI 重连并按 sequence 补发。
- Journal 满：按策略截断旧数据并发送 `history_gap`，不阻塞 PTY。
- Core 崩溃或升级：Session 终止，元数据和审计恢复，状态标记 interrupted。
- Shell completion frame 缺失：状态为不确定错误或交互，不得标记成功。

### Verification Strategy

纯领域逻辑、IPC framing、Shell literal 编码、Policy AST 分类和状态机使用单元测试及性质测试。Provider Adapter 使用录制的 SSE/流式事件 fixture 做契约测试。Session 与 Command Transaction 使用 fake PTY 和 Windows Git Bash 集成测试；ConPTY、中文、resize、Ctrl+C、TUI 和大输出在 Windows CI 与本机测试。

Electron 使用 Playwright 验证创建 Session、终端非空、Agent 任务、审批、接管、UI 重连和错误状态，并保存桌面与最小窗口截图检查重叠和文本溢出。打包测试在干净 Windows 环境安装、启动独立 Core 并加载所有原生模块。

性能基线：20 个空闲 Session、4 个并发 Agent Task、单 Session 持续高输出时 UI 可交互；慢模型和慢 UI 不得让 PTY ingestion 无界增长。

### Validated Spike Results

2026-07-27 的 Windows x64 Spike 已验证：

- `node-pty` 可通过 ConPTY 启动、读取并结束短生命周期控制台进程。
- Node 24.12 `node:sqlite` 可完成内存数据库建表、写入和读取；运行时固定以隔离 experimental API 风险。
- `web-tree-sitter` 可加载 `@vscode/tree-sitter-wasm` 的 Bash grammar 并解析 pipeline AST。
- `@xterm/headless` 与 `@xterm/addon-serialize` 可生成快照，但必须设置 `allowProposedApi: true`，且 serialize 前必须等待异步 write callback。
- `@napi-rs/keyring` 可在 Windows Credential Manager 中完成临时凭据写入、读取和删除。
- native `better-sqlite3`、`sqlite3` 和 Node Tree-sitter 在当前 Node 24 环境可能回退到 node-gyp，需要 Visual Studio C++ Build Tools，因此被内置 SQLite 与 WASM parser 替代。
- POSIX 包装在 Git Bash 中保持 `cd`、`export`、引号、多行和 here-doc；pipeline 返回当前 Shell 暴露的状态。
- `set -e`、`exit` 和 `exec` 会绕过完成 OSC，系统必须按缺失完成帧处理，不能推断成功；EXIT trap 不破坏已有完成帧。
- PowerShell `-NonInteractive -Command` 不作为 ConPTY 交互 Session 的启动方式；真实 PowerShell Shell 行为在 Windows 端到端任务中验证。

### OpenSpec Change Evolution and Archival

本 change 是 MVP 唯一实施事实源。实现中发现的实现细节、Spike 结论或不改变能力契约的优化直接更新本 change 的 design/tasks，并保持 specs 一致。只有出现新的用户能力、改变既定非目标、引入外部 MCP/企业控制面或需要独立发布节奏时才创建新 change。

每个任务完成后立即勾选并提交。所有 requirements 有测试证据、tasks 全部完成、严格校验通过、delta specs 同步到主规格后才能归档。归档目录使用 OpenSpec 日期前缀，Git tag 标记 MVP 里程碑。

## Risks / Trade-offs

- [PTY 只有无结构字节流] -> 使用 ShellProbe、私有 OSC 完成事件、状态置信度和不确定即失败策略。
- [命令包装改变 Shell 语义] -> 使用顶层 eval、性质测试和真实 Shell Spike；`exit`/`exec` 等显式视为边界情况。
- [Shell alias 或恶意环境绕过只读判断] -> Ready Session 属于用户信任边界；检测 override，无法证明时要求授权。
- [原生 Node 模块打包失败] -> 第一里程碑先验证固定 Node Runtime、node-pty 和 keyring；SQLite 使用内置模块，Shell Parser 使用 WASM，减少编译工具链依赖。
- [`node:sqlite` API 仍为 experimental] -> 固定 Node 24.12 Runtime，通过仓储接口和契约测试隔离 API，并在升级 Runtime 前执行兼容性 change。
- [Electron 资源占用较高] -> Core 与 UI 分离、限制 scrollback 和日志、批量 IPC；优先团队交付速度和终端生态。
- [OSC Parser API 为实验性] -> 封装 `CommandProtocol`，固定依赖版本并保留 printable marker fallback 的测试实现。
- [自动脱敏漏报或误报] -> 密码输入绝不采集，模型披露采用保守规则，用户本地终端仍显示原始输出。
- [Core 单点故障终止全部 Session] -> MVP 明确不承诺跨 Core 恢复；持久化元数据和审计，未来可用独立 pty-host change 演进。
- [多 Provider 行为差异] -> 统一内部事件、fixture 契约测试和能力探测，不依赖 Provider 自报。
- [精确授权增加交互次数] -> 只读安全命令自动执行；用安全性换取变更命令的额外确认。

## Migration Plan

项目为绿地实现，无历史数据迁移。按以下里程碑交付：

1. 建立 monorepo、共享协议和原生模块 Packaging Spike。
2. 完成独立 Core、Named Pipe、SessionActor、node-pty、headless terminal 和重连。
3. 完成 ShellProbe、Command Transaction、OutputJournal 和交互接管。
4. 完成 Provider Adapter、AgentRuntime、ToolGateway、PolicyEngine、Credential Manager 和审计。
5. 完成 Electron UI、端到端流程、安装包、性能与安全验证。

数据库使用显式 schema version 和启动前备份。升级 Core 会终止活动 Session，安装程序必须在升级前提示并允许取消。回滚恢复上一安装版本和兼容数据库备份；不尝试恢复已经断开的 PTY。

## Open Questions

无阻塞开放问题。首个 Packaging/Command Protocol Spike 可能调整内部库或封装，但不得降低 specs 中的行为要求；若 Spike 证明能力边界不可行，应更新本 change 的 proposal/specs，而不是静默缩小目标。
