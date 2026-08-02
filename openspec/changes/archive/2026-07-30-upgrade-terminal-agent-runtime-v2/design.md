## Context

v0.1.0 已具备独立 Core、ConPTY Session、Provider Profile、四个 Terminal Tool、策略审批和审计，但真实使用暴露出下列结构问题：

- `AgentCoordinator` 在每次用户消息前无条件运行 POSIX ShellProbe，导致 PowerShell 收到 `eval`、`printf`、`unset` 等无效语法。
- `ContextBuilder` 要求模型“只能使用终端工具”，并默认把当前终端屏幕发送给模型，既不支持普通对话，也没有做到显式 Tool 披露。
- Provider 中立消息只保存文本 role/content；assistant tool call 本身没有进入下一轮消息，OpenAI Responses、Chat Completions 和 Anthropic 无法可靠收到合法的 tool result 链。
- ToolGateway 错误默认终止 Agent Task，模型无法根据可恢复错误修正命令或方案。
- 每条输入创建孤立 Agent Task，没有 Session 范围的多轮 Conversation；流式 delta 被拆成大量时间线条目，最终文本还会重复追加。
- Provider 测试只改变状态点，不返回失败原因。实际试用中的 HTTPS/HTTP scheme 错误已写入数据库，但 UI 没有可见反馈。
- `ProviderProfile` 同时保存协议、端点、凭据引用、模型 ID、上下文与能力，导致一个连接无法复用多个模型，Agent 也只能选择“连接配置”而不是稳定的模型目录条目。
- Session 启动配置把 `bash.exe` 和 `C:/Users` 等假设直接放在 Renderer，Git Bash 未加入 PATH 时创建 Session 失败。
- 当前规格明确排除了本机文件 Tool 和 PowerShell 结构化执行，本变更需要正式修改这些边界。

本变更不引入 SSH、堡垒机、容器或服务器资产模型。Terminal Session 仍是用户已经准备好的本地 PTY；Agent 只关心当前 Session 的终端状态和用户主目录内的本机文件。

## Goals / Non-Goals

**Goals:**

- Agent 在同一个 Session Conversation 中支持普通多轮对话，也可自主循环调用 Tool 直到完成目标。
- 终端观察、命令执行和本机文件内容仅通过显式 Tool Call 披露给模型。
- 为 POSIX 与 PowerShell 提供独立 ShellDriver，普通对话和只读观察不运行 ShellProbe。
- 正确映射 OpenAI Responses、OpenAI-compatible Chat Completions 和 Anthropic Messages 的 assistant tool call 与 tool result。
- 提供四个 Terminal Tool 和五个本机文件 Tool，并由同一 Runtime、策略、审批和审计边界管理。
- 本机文件根目录动态解析为当前用户主目录，普通文件允许自主写入，敏感路径要求确认。
- 所有产品 UI 文案使用简体中文，Provider/Agent/Session 失败明确可见。
- 用真实本地 HTTP Provider、真实 ConPTY、真实文件系统和打包桌面程序完成端到端验证。
- 支持可配置 Context Window、自动上下文压缩、模型选择、推理强度和 Conversation 级 Permission Mode。
- 将 Provider 连接与可选模型拆成独立实体，在独立“模型”页面管理，并使每个 Turn 固定记录实际模型选择。
- 参考用户提供的终端工作区示意重构 Session、资源信息、Agent 时间线和主终端布局，并支持系统/明亮/暗黑主题。
- 通过 `ssh example-host` 在不修改目标服务器任何配置、文件或数据的前提下完成真实只读验证。

**Non-Goals:**

- 不让模型创建、关闭、列举或切换 Terminal Session。
- 不让模型改变本机文件根目录、ShellDriver 方言、Provider 凭据、Model Configuration 或审批策略。
- 不提供任意按键、密码输入、完整 TUI 自动化、文件删除、移动、权限修改、注册表或浏览器 Tool。
- 不把本机文件 Tool 当作远程文件 Tool；远程文件仍通过当前终端命令处理。
- 不要求真实外部 OpenAI/Anthropic 凭据作为自动化测试前提。
- 不保存或展示模型隐藏推理过程；UI 只显示用户消息、可见回复、Tool 活动和简短进度状态。
- 不把资源面板变成常驻监控系统，不自动轮询未知 Shell/TUI，也不维护服务器 IP、凭据或连接拓扑。

## Decisions

### Conversation, Turn, and Run Model

每个 Session 默认拥有一个 `AgentConversation`，用户可显式清空并开始新 Conversation。每条用户消息创建一个 `AgentTurn`，一个 Turn 内可以包含多个 Model Run 和 Tool Call。Conversation 保存经过脱敏与大小限制的结构化历史，而不是把旧 `AgentTask.goal` 作为唯一上下文。

状态拆分为：

```text
Conversation: active | reset
Turn: queued | running | waiting_approval | waiting_user
      | completed | failed | cancelled | suspended
ToolCall: proposed | validating | waiting_approval | running
          | completed | recoverable_error | fatal_error | cancelled
```

一个 Session 同时最多一个活动 Turn，全局默认最多 4 个活动 Turn。旧 `agent_tasks` 数据保留为历史记录；schema migration 新增 Conversation、Turn 和 Model Item 表，不尝试把旧孤立任务伪造成连续对话。

备选方案是在现有 `AgentTask` 上追加 history JSON。该方案会把任务生命周期、对话生命周期和 Provider 消息混在一个记录中，审批恢复和审计查询更难，因此否决。

### Provider-Neutral Structured Model Items

内部不再使用只有 role/content 的 `ModelMessage`，改为判别联合：

```text
system_text
user_text
assistant_text
assistant_tool_call(id, name, argumentsJson)
tool_result(toolCallId, content, isError)
```

AgentRuntime 持有完整 Model Item 列表。每次模型产生 Tool Call，Runtime 先追加 `assistant_tool_call`，Tool 执行后追加 `tool_result`，再发起下一轮模型调用。

Adapter 映射规则：

- OpenAI Responses：function call item 与 `function_call_output`。
- Chat Completions：assistant `tool_calls` 与 role=`tool` message。
- Anthropic Messages：assistant `tool_use` block 与 user `tool_result` block。

Provider 可见 Tool 名使用下划线：`terminal_observe` 等。Core 内部使用稳定逻辑标识并在 Adapter 边界映射，避免部分兼容端点拒绝带点函数名。

### Provider Profiles, Model Configurations, and Model Catalog

模型配置拆成两个可独立复用、独立持久化的实体：

```text
ProviderProfile
  id, name, protocol, baseUrl, credentialRef, extraHeaders, timeoutMs, revision

ModelConfiguration
  id, name, providerProfileId, modelId
  contextWindowTokens, maxOutputTokens, autoCompact, compactThresholdPercent
  supportedReasoningEfforts, defaultReasoningEffort
  enabled, isDefault, validation, revision
```

`ProviderProfile` 只定义如何连接模型服务，凭据值继续保存在 Secret Store，Renderer 只接收凭据是否已配置的非敏感状态。一个 Provider Profile 可以被多个 Model Configuration 引用，例如同一 OpenAI-compatible 地址下配置两个模型。`ModelConfiguration` 才是 Agent 可选择的目录条目，能力检测也绑定该条目，因为 streaming、Tool Call、上下文与推理参数支持取决于具体模型，而不能只由端点推断。

Core 的 `ModelCatalogService` 负责 CRUD、启用/停用、唯一默认模型和引用完整性。`enabled = true` 是进入 Agent 模型列表和成为默认模型的唯一目录状态条件；validation 是可选诊断，不是启用、默认或保存的门禁。Provider 或 Model Configuration 的连接相关字段发生变化时，受影响模型的 validation 重置为 `unverified`，但保存必须保留用户的 enabled/default 意图。未检测或检测失败的已启用模型使用声明能力尝试运行，Provider 失败进入可见 Turn 错误。删除仍被 Model Configuration 引用的 Provider Profile 必须拒绝；删除历史 Turn 使用过的 Model Configuration 可以执行，因为 Turn 保存不可变快照，但活动 Turn 使用的条目不得删除。

备选方案一是只把现有 Provider 表单移动到独立页面，仍让一个 Profile 等于一个模型；它无法支持连接复用，也不能精确表达验证与启用状态。备选方案二是在 Provider Profile 内嵌 `models[]`；它会让独立 revision、默认模型、审计引用和部分更新变复杂。因此采用独立实体与引用关系。

### Provider Model Discovery and Quick Configuration

Core 新增 `ProviderModelDiscoveryService`，通过已保存 Provider Profile 的 Adapter 调用模型列表能力。OpenAI Responses 与 OpenAI-compatible Profile 使用官方 `openai` SDK 的 Models API，Anthropic Profile 使用官方 `@anthropic-ai/sdk` 对应 Models API；在标准 Base URL 下最终访问 `/v1/models`。Renderer 只提交 `providerProfileId`，Core 从 Secret Store 解析凭据与额外请求头，任何密钥和原始鉴权头都不得进入返回值或审计。

发现结果统一为有界 `DiscoveredModel`：`id`、可选 displayName/owner/createdAt 和来源 Provider。服务支持 SDK 分页但设置最大页数、最大 500 个模型、总超时与取消；对鉴权失败、端点不支持 Models API、响应结构错误和分页循环返回稳定错误。返回前按模型 ID 去重并稳定排序，不把 Provider 原始响应整体保存。

模型发现入口位于“模型配置”视图，而不是 Provider 连接视图。用户先为当前 Model Configuration 选择 Provider Profile，再点击“拉取模型”；Core 返回搜索友好、稳定排序的发现结果，Renderer 将模型 ID 控件切换为可选下拉列表，选中后回填当前配置。对不支持 Models API 或未列出的自定义模型保留手动输入回退。新配置初始为 `enabled = false`、`validation = unverified`；用户可直接启用，也可先运行诊断，二者互不依赖。

备选方案一是让 Renderer 直接请求 `/v1/models`，会泄漏凭据并绕过 Core 网络、超时和审计边界；备选方案二是拉取后自动全部启用，会把仅能列出但不支持 streaming/Tool Call 的模型暴露给 Agent。因此模型发现与模型验证保持两个阶段。

### Autonomous Tool Loop Without Forced Tool Use

系统提示要求模型仅在需要外部证据或副作用时调用 Tool；普通问候、能力介绍或概念讨论可以直接输出文本。Runtime 流程为：

```text
user item -> model stream
  -> no tool calls before any Tool: complete pure-chat turn with assistant text
  -> tool call: validate -> policy/approval -> execute -> tool result
               -> append result -> next model run
  -> no tool calls after any Tool: buffer candidate answer
               -> completion review with original goal + structured evidence
                  -> missing evidence: call existing Tool and continue loop
                  -> complete: publish reviewed final answer once
```

Tool 结果为可恢复错误时仍返回模型，由模型调整方案。Schema 破坏、越权、凭据边界失败和重复无进展调用视为 fatal。Runtime 默认限制 24 个 Model Run、40 个 Tool Call、连续 3 次相同失败调用和可配置总时长；达到限制时给出明确失败与已有结果摘要。

只要当前 Turn 已经成功或失败地调用过任一 Tool，后续第一次没有 Tool Call 的 assistant 文本就不是最终完成信号，而是候选答案。Runtime 使用同一不可变 Model Configuration、Provider Profile 和结构化 Turn 上下文发起完成性复核，明确要求模型逐项对照用户原目标与实际 Tool Call/Result：缺少证据或操作时必须调用现有九个 Tool 继续执行；确认完整时输出校正后的最终答案。复核不引入第十个 Tool，也不使用写死的目标主机、命令或任务清单。

候选答案仅存在于活动 Runtime 内存，不调用 `onItem`、不写入 `model_items`、不进入 Timeline，也不作为 assistant item 发送给完成性复核模型。复核请求只使用原目标、结构化 Tool 证据和内部复核指令；确认后的文本必须完整、自包含，不得引用对用户不可见的候选答案，随后才通过稳定 assistant item 发布并持久化一次。普通纯聊天沿用首轮实时流式输出，不发起完成性复核；工具任务的复核文本先缓冲，确认没有 Tool Call 后再提交，避免用户看到随后被撤回的“已完成”答案。

完成性复核默认最多 3 次，并与普通 Model Run 共同受总 Model Run、Tool Call、活动时长、取消和 UI 断开限制。复核发起 Tool Call 时，调用及结果照常持久化、审批和审计；复核次数耗尽仍无法确认完成时，Runtime fail closed 为可见失败，而不是发布未复核候选答案。审批暂停点必须保存复核计数和当前循环状态，以便批准后继续原 Tool Call 而不跳过复核。

模型一次返回多个 Tool Call 时按 Provider 顺序串行处理。第一个等待审批、等待用户或产生副作用的阻塞调用暂停后续调用，避免持久 Shell 和文件状态并发竞态。

### Versioned Agent System Prompt Contract

`ContextBuilder` 生成版本化、可契约测试的 Agent 系统提示词，而不是不可维护的超长自由文本。提示词必须包含：当前 Session 和 Conversation 绑定；直接回答与 Tool Call 的选择条件；先取得证据再下结论；Terminal 与本机文件 Tool 的边界；不得伪造命令、输出、文件内容或修复结果；Permission Mode 只改变审批而不扩大能力；密码提示、TUI 和不受支持的交互必须停止并请求用户接管；可恢复 Tool 错误应返回并调整方案；最终回复应区分已验证证据、已执行操作、结论、未解决风险和必要的下一步。

系统提示词不得要求模型暴露 chain-of-thought，不得默认携带终端屏幕或本机文件内容，不得声称可切换 Session、建立 SSH 连接或绕过 Core 安全边界。提示词版本和关键章节标识进入测试与运行时诊断，便于在不泄露敏感上下文的前提下追踪行为变化。

### Explicit Context Disclosure and Just-in-Time Lease

新 Turn 的初始上下文只包含系统规则、Conversation 历史、用户消息以及最小 Session 元数据，不自动包含终端屏幕。模型要检查终端必须调用 `terminal_observe`。

普通对话与 `terminal_observe` 不获取 Agent 输入 Lease，也不运行 ShellProbe。只有 `terminal_execute` 在实际写 PTY 前才获取 Lease、验证方言 capability epoch 并执行策略。用户人工输入或接管会使 epoch 失效。

该选择同时减少无关终端秘密披露，并避免纯聊天污染 PowerShell。

### Context Budget and Automatic Compaction

Model Configuration 保存 `contextWindowTokens`、`maxOutputTokens`、`autoCompact` 和 `compactThresholdPercent`。Core 根据结构化 Model Item 估算输入 Token，并为系统提示、下一轮 Tool Result 和输出保留 headroom。达到阈值时创建持久化 `ConversationCompaction`：较老的用户、assistant、Tool Call 与 Tool Result 被压缩为一个有界 system summary，后续请求使用 summary 加近期精确 Item；原始记录不删除，仍可用于审计和 UI 历史。

优先使用当前 Provider 进行无 Tool 的摘要 Model Run；若 Provider 摘要失败，使用确定性的提取式 fallback，保留目标、关键结论、已执行 Tool、错误和未完成事项。压缩本身受独立超时、大小和递归次数限制，不计入用户 Turn 的 Tool Call 上限，但计入模型调用与审计。

备选方案一是简单截断旧消息，会丢失约束和已完成动作；备选方案二是每次发送完整历史，最终必然超过自定义模型的上下文窗口，均否决。

### Per-Turn Model Selection and Reasoning Settings

聊天框的模型下拉框只显示已启用 Model Configuration，并默认选中目录中的唯一默认模型；没有已启用模型时不能创建 Turn，并提供跳转到“模型”页面的明确入口。发送请求携带 `modelConfigurationId`，Core 在创建 Turn 前重新校验条目存在、启用且 Provider Profile/凭据可解析，不能信任 Renderer 提供的名称、模型 ID 或能力；validation 状态不阻止 Turn。

Turn 保存不可变的 `modelConfigurationId`、`modelConfigurationRevision`、`providerProfileId`、`providerProfileRevision`、`modelId`、已解析能力和 `reasoningEffort = low | medium | high | xhigh`。配置在 Turn 启动后被编辑、停用或删除，不改变正在运行的 Adapter 或历史展示。后续新 Turn 必须重新解析当前目录状态；找不到、未验证、不可用或已停用均以稳定错误阻止创建。旧数据中的 `minimal` 在迁移或读取兼容边界映射为 `low`，新协议和 UI 不再产生 `minimal`。

UI 不显示隐藏推理内容。推理强度只影响 Provider 请求参数、Token 预留和时间预算。

### Permission Modes

Permission Mode 绑定 Agent Conversation，并由 Core 持久化与审计：

- `manual`（人工审批）：每个 `terminal_execute` 命令均暂停审批，包括只读诊断；本机文件写入和敏感读取同样审批。
- `auto`（自动审批）：普通 `mutating` 操作可自动执行；`unknown`、`privileged`、`destructive` 和敏感披露仍要求审批。
- `full_access`（完全权限）：所有已通过 Schema、路径和 Session 边界校验的内置 Tool 不再弹出审批；风险、命令、文件哈希和结果仍完整审计。

`full_access` 不增加 Tool，不允许切换 Session，不允许本机路径逃逸，不允许 Protected Input 披露，也不绕过 expected hash、Lease epoch 或 Tool 参数校验。模式变化只影响后续 Tool Call，活动审批不会被静默升级。

Terminal 命令的风险分类必须使用 Tool Call 执行时 Session 的当前 `executionDialect`。POSIX 命令继续使用 Bash AST 与保守命令规则；PowerShell 使用独立的保守分类器识别只读 Cmdlet、普通变更、提权/服务控制、删除/格式化等破坏性操作，以及 PowerShell 常用别名。无法可靠解析的脚本、动态调用和未知命令统一归为 `unknown`。Permission Mode 只消费规范化后的 `read_only | mutating | unknown | privileged | destructive` 风险，不得因为 PowerShell 命令未被 POSIX allowlist 识别而把所有命令都退化为同一审批行为。

### Session Resource Snapshot

新增内部 `SessionResourceService`，不作为 Provider 可见 Tool。用户点击“刷新资源”后，Core 在当前 Session 空闲且方言可执行时获取短期系统 Lease，运行固定只读命令并解析为 CPU、负载、内存、交换分区、磁盘、网络、主机、OS 和 uptime 快照。POSIX 与 PowerShell 使用独立命令模板；解析失败时保留可用字段并返回中文状态，不猜测数据。

资源采集不自动轮询，因为应用无法知道用户是否仍在 SSH 登录、堡垒机菜单、密码提示或 TUI 中。用户完成 `ssh`、容器或堡垒机跳转并设置正确 execution dialect 后再显式刷新，快照自然代表当前终端所处环境。

### Desktop Workspace, Timeline, and Theme

桌面端不保留左侧 Session rail。多 Session 由主终端上方的标签条负责切换、关闭和新建；标签条必须展示所有已打开 Session，不只展示当前项。主工作区是“终端 + 可选右侧面板”两列，两列之间提供有界拖拽分隔条。右侧面板顶部是可独立折叠的当前 Session 资源快照，其下是 Agent Markdown 时间线和固定 composer；资源折叠后时间线占满释放高度。composer 的模型、推理和权限控件收敛为固定底部紧凑工具栏，不随 textarea 或时间线滚动。关闭右侧面板时必须移除对应网格轨道，主终端立即占满全部剩余宽度，不能保留空白区。窄窗口下右侧面板变为可切换抽屉，仍保证终端可用。

assistant 文本使用安全 Markdown 渲染，支持 GFM、代码块、表格、列表和链接；命令、Tool、审批与系统事件仍使用专用 Timeline Item，禁止直接渲染模型 HTML。发送区只提供 eligible Model Configuration 下拉框、推理强度和 Permission Mode 控件，以及取消、重置对话和发送状态，不嵌入 Provider 或模型编辑表单。

顶层导航增加独立“模型”功能页面，不使用覆盖终端工作的设置弹窗。该页面包含“模型配置”和“Provider 连接”两个视图：模型配置视图负责模型目录、Provider 选择、`/v1/models` 拉取、模型 ID 下拉/手动输入、启用/停用、默认项、能力检测与模型参数；Provider 连接视图只负责协议、Base URL、凭据、请求头和超时。两类实体通过显式引用关联，删除和失效状态在页面中清晰展示。

主题支持 `system | light | dark`，默认 `system` 并监听操作系统变化。颜色全部由语义 CSS 变量提供，设置持久化到桌面偏好；终端主题与应用主题同步。明亮主题的 xterm `foreground`、`cursor`、`selectionBackground` 以及 ANSI `white/brightWhite` 等颜色必须对浅色背景保持可读对比度，不能把 ANSI 白色映射为接近背景的白色。

### Simplified Session Creation

标准“新建终端会话”只要求名称和动态发现的 Shell。Main 使用 `app.getPath('home')` 作为 cwd，Renderer 不再展示 working directory；用户进入 Session 后可直接 `cd` 或运行 `ssh`。底层协议继续保存 cwd 以支持测试、恢复元数据和未来受控启动 Profile，但普通用户无需理解该字段。

### Built-in Tool Set

模型只获得九个内置 Tool：

```text
terminal_observe
terminal_execute
terminal_wait
terminal_interrupt
local_list_files
local_search_files
local_read_file
local_write_file
local_edit_file
```

Terminal Tool 不包含 `sessionId`。Local Tool 不包含根目录参数，只接受相对当前用户主目录的路径。Tool 定义由共享 Zod Schema 生成；Provider 返回未知字段、绝对路径或未知 Tool 时 fail closed。

不增加 `plan` Tool。自主规划属于模型循环行为，UI 只显示“正在分析”“正在观察”“正在执行”等可验证进度，不要求披露 chain-of-thought。

### ShellDriver and Execution Dialect

引入统一 `ShellDriver`：

```text
probe(task/lease/nonce) -> capability
wrap(command, nonce) -> bytes written to PTY
parse(control event) -> completion
```

实现：

- `PosixShellDriver`：保留经过测试的顶层 eval 与 OSC 777 事务协议。
- `PowerShellDriver`：使用 PowerShell ScriptBlock/编码载荷和独立 OSC 777 完成协议，保持 `Set-Location`、变量和 `$LASTEXITCODE` 语义。
- `ObserveOnlyDriver`：允许观察和普通对话，拒绝结构化执行。

Session 保存 `executionDialect = posix | powershell | observe_only`。默认值来自本地启动 Shell；用户可在已经 SSH 或切换环境后显式调整当前方言。Core 不解析 SSH 拓扑，也不盲目依次注入多种 Probe。

Probe 只在第一次 `terminal_execute` 或 capability epoch 失效后的下一次执行前运行，并且只使用当前方言语法。

### Dynamic Shell and Home Resolution

生产代码不得包含用户特定目录、盘符或固定 Git 安装绝对路径。

- Core 使用 `os.homedir()` 获取当前用户主目录并通过 `realpath` 固化边界。
- Electron 使用 `app.getPath('home')` 提供新 Session 默认 cwd，并与 Core 报告的用户范围保持一致。
- Git Bash 通过 PATH、Git for Windows 注册表和由 `ProgramFiles`、`ProgramFiles(x86)`、`LOCALAPPDATA` 等环境信息构造的候选位置发现。
- PowerShell 和 WSL 通过 PATH、`SystemRoot` 和系统组件发现，不写死盘符。
- Renderer 只收到 Shell descriptor：kind、label、resolved executable、available、source；创建不可用 Shell 时在本地立即显示中文原因。

解析器与文件系统访问通过接口注入，测试使用临时目录和假环境，不依赖开发机路径。

### Local File Boundary and Operations

`LocalFileService` 运行在 Core，不在 Renderer。根目录为动态当前用户主目录，模型只使用相对路径。路径处理流程：

1. 拒绝绝对路径、驱动器前缀、UNC、设备路径、Alternate Data Stream 和 NUL。
2. 规范化 `.`/`..` 并拒绝逃逸。
3. 对现有路径执行 `realpath`；对新文件执行最近存在父目录的 `realpath`。
4. 使用 Windows 大小写不敏感语义确认 canonical path 仍在 canonical home root 内。
5. 拒绝通过 symlink、junction 或 reparse point 越界。

Tool 行为：

- `local_list_files`：有界列出目录，返回类型、大小、修改时间和相对路径。
- `local_search_files`：在指定相对目录中按文件名或文本搜索，具有深度、结果数、字节数、超时和取消边界。
- `local_read_file`：读取 UTF-8/带 BOM UTF-16 文本的指定行或字节范围，返回内容、截断信息和 SHA-256；二进制文件拒绝作为文本披露。
- `local_write_file`：显式 `create` 或 `replace`。replace 必须携带预期 SHA-256，使用同目录临时文件、flush 和原子替换。
- `local_edit_file`：提交一组精确 oldText/newText 编辑及预期 SHA-256；匹配数量不符或文件变化时拒绝，成功后原子替换。

第一版不提供 delete、move、chmod、registry 或 arbitrary local process Tool。远程文件操作继续通过 Terminal Tool 完成。

### Local File Policy, Secrets, and Audit

普通用户文件的 list/search/read/create/edit 可按用户选择的 A 策略自动执行。以下路径或内容由本地 `LocalFilePolicy` 提升为敏感或高影响并要求审批：SSH/云/Kubernetes 凭据、`.env*`、包管理器认证文件、浏览器 Profile、Windows Startup、PowerShell Profile、应用凭据目录、私钥/Token 特征和其他可配置规则。

读取敏感文件同样需要审批，因为内容会通过 Tool Result 披露给外部模型。Tool Result 在发送前经过 SecretRedactor；Renderer 本地 Diff 可显示必要原文，但不得把 Provider API Key 或 Protected Input 放入审计。

文件审计记录 actor、Conversation、Turn、Tool Call、相对路径、操作、风险、审批、前后 SHA-256、字节数、时间和结果。默认不长期保存完整文件内容。

### Model Validation and Provider Diagnostics

Model Configuration validation 使用其引用的 Provider Profile 创建 Adapter，并使用独立 AbortController 和总超时，禁止同一模型重复点击并发测试。验证结果返回：status、checkedAt、attempt、streaming、toolCalls、responses、reasoning 支持和 reason。

只有收到合法流事件和指定 probe Tool Call 才把该 Model Configuration 标记可用。连接、TLS、鉴权、模型不存在、协议响应错误和缺少 Tool Call 分别映射为稳定错误码与中文说明，并保留原始技术详情。Provider Profile 只报告凭据缺失、引用错误或基础配置错误，不伪造“模型可用”状态。

对 loopback HTTP 地址允许保存并显示“本机明文 HTTP”提示；非 loopback HTTP 显示凭据明文传输高风险警告。对于 HTTPS 指向实际 HTTP 服务的握手失败，UI 提示检查 URL scheme。

### Chinese Desktop Experience

Renderer、独立模型页面、Dialog、状态栏、审批、接管、模型测试、审计、空状态、错误横幅和 tooltip 全部使用简体中文。Electron Main 使用 `Menu.setApplicationMenu(null)` 移除原生应用菜单，并在 BrowserWindow 上关闭菜单栏可见性，避免 Windows 按 `Alt` 后重新显示；常用命令入口由应用内顶栏和工作区控件提供。OpenAI、Anthropic、Responses、Chat Completions、模型 ID、URL、命令、路径、终端输出和模型回复不翻译。

Agent 时间线使用稳定 item ID 聚合 text delta，避免每个 token 一条记录和最终答案重复。Tool 活动在实时和历史 hydration 中复用同一紧凑可折叠条目，摘要显示名称、目标相对路径或命令和状态，长结果默认折叠在有界内容区。审批事件以稳定 ID 原位更新，只有 `waiting_approval` 显示操作按钮，批准、拒绝、取消和交互结束后立即变为不可操作终态。Agent 正文和输入区使用舒适的桌面阅读字号，Tool 摘要与元信息可略小但不得牺牲可读性。任何 Turn 失败都产生中文 system item，包含可操作原因；不能只在数据库中标记 failed。

### Persistence and Migration

新增 schema migration：

- `agent_conversations`
- `agent_turns`
- `model_items`
- `tool_calls`
- `model_configurations`
- Session `execution_dialect`

迁移前沿用现有版本化 SQLite backup。每个旧 Provider Profile 保留原 ID、协议、端点、凭据引用、请求头和超时，并把原 `model`、Context Window、压缩、推理能力与 validation 字段迁移为一个同名 Model Configuration。旧 available 状态只有在能力结构完整时映射为 available，否则重置为 `unverified`；首个 eligible 条目成为默认模型。旧 Agent Task、Command Transaction 和审计保持可查询，新 Turn 使用模型选择快照，不删除凭据引用。

### Verification Strategy

严格使用 TDD：每个新领域类型、Adapter 映射、ShellDriver、路径边界、文件原子操作、策略和 UI 状态先写失败测试并观察正确失败，再实现最小代码。

自动化层次：

- 单元/性质测试：Provider/Model 分离、模型目录不变量、Model Item、Runtime loop、重复调用保护、POSIX/PowerShell wrapper、路径规范化、symlink/junction 逃逸、hash conflict、敏感策略和中文错误映射。
- 模型发现契约测试：OpenAI/compatible 与 Anthropic Models API 的鉴权、分页、去重、上限、取消、unsupported 响应和批量导入幂等性。
- Provider 契约测试：三种协议的 assistant tool call -> tool result -> final text 完整第二轮请求结构。
- Core 集成测试：fake Provider 驱动纯聊天、多 Tool 循环、recoverable error、审批暂停/恢复、用户接管和本机文件组合任务。
- 真实 HTTP Provider E2E：本地进程提供 OpenAI-compatible SSE/tool-call endpoint，官方 `openai` SDK 经过真实 TCP/HTTP 完成测试、聊天和至少两轮 Tool 循环。
- 真实 ConPTY E2E：Git Bash POSIX 与 PowerShell 分别执行状态保持、退出码、持续输出、Ctrl+C；验证普通聊天不向 PTY 写任何 Probe 字节。
- Electron Playwright：全中文 UI、独立模型页面、Provider/模型 CRUD、默认与启用状态、动态 Shell 发现、Session 创建、模型成功/失败反馈、普通聊天、终端诊断、文件读取编辑、审批、错误时间线和最小窗口无重叠。
- Packaged E2E：`release/win-unpacked` 与安装后的应用启动固定 Core Runtime，连接本地 Provider、执行真实 PTY 和临时用户目录文件任务。
- Packaged Permission E2E：在真实 PowerShell ConPTY 中覆盖 `manual` 只读自动执行与变更审批、`auto` 普通变更自动执行和 unknown/privileged/destructive 审批、`full_access` 破坏性操作无审批执行，并核对命令副作用与结构化审计中的方言、风险和授权方式。
- 真实目标只读验证：使用用户已有本机 SSH 配置进入 `example-host`，在 `manual` Permission Mode 下仅允许 `uname`、`uptime`、CPU/内存/磁盘/网络读取命令；任何写命令或审批请求都视为失败，审计证明没有目标端副作用。

真实外部 Provider 凭据不纳入自动化门禁，但发布报告必须明确这一边界。

## Risks / Trade-offs

- [PowerShell 与 POSIX 状态语义不同] -> 独立 ShellDriver、真实 ConPTY 契约测试，不共享命令包装代码。
- [用户通过 PowerShell SSH 到 POSIX 后方言变化] -> 人工输入使 capability epoch 失效，下一次结构化执行先发送有界、只读、跨方言指纹并忽略回显行，再选择正确 ShellDriver；Core 不解析连接拓扑或盲发完整 Probe。
- [本机用户主目录范围较大] -> 相对路径、canonical root、reparse point 防逃逸、结果/深度/时间上限和敏感路径审批。
- [普通文件自动写入可能产生广泛修改] -> 无 delete/move，replace/edit 使用 expected hash，原子写入并完整审计；敏感和高影响路径始终审批。
- [多 Provider Tool 格式差异] -> 结构化 Model Item 作为唯一内部事实源，每个 Adapter 使用请求形状契约测试。
- [Provider 更新可能使多个模型静默失效] -> Provider revision 变化时统一把引用模型重置为 `unverified`，Agent 只消费 eligible list。
- [删除或修改模型配置会污染运行中任务和历史] -> Turn 启动时保存完整选择快照，活动引用禁止删除，历史只读展示不回查当前配置。
- [`/v1/models` 可能返回成百上千或非标准分页] -> Core 设置页数/条数/时间上限、检测游标循环、稳定去重排序并允许取消。
- [模型可被列出但不支持 Agent Tool] -> 发现条目默认 disabled/unverified，必须完成独立能力检测后才可启用。
- [模型可能无限循环或重复失败] -> Model Run、Tool Call、总时长和重复调用限制，达到上限后可见失败。
- [模型可能在只完成部分 Tool 子目标后提前宣告成功] -> Tool 使用后的候选答案必须经过有界完成性复核；缺口继续 Tool Loop，候选文本不进入 Timeline/历史，复核耗尽则 fail closed。
- [中文化遗漏异步错误或原生菜单重新出现] -> DOM 文案扫描、Main/BrowserWindow 菜单禁用测试、错误码映射和截图证据。
- [本地测试 Provider 与真实供应商仍有差异] -> 官方 SDK 真实 HTTP E2E 加录制 fixture；发布报告继续声明未使用真实外部凭据。
- [资源刷新可能干扰登录或 TUI] -> 只允许用户显式触发、要求 Session 空闲、使用固定只读命令且不自动轮询。
- [完全权限被误解为取消所有安全边界] -> UI 明确说明、Core 保留不可绕过的 Tool/路径/Lease/Secret 边界并记录模式变更审计。
- [上下文摘要遗漏细节] -> 原始历史不删除，摘要包含来源序号，保留近期精确消息并允许用户重置 Conversation。

## Migration Plan

1. 先完成 Provider Profile/Model Configuration 领域、协议、数据库拆分与备份迁移测试，使 v0.1.0 数据可由新 Core 打开。
2. 引入 Model Catalog、Agent Model Selection 快照、Model Item 与 Runtime v2，同时保留旧表只读，不在新 Turn 中调用旧 Runtime。
3. 引入 ShellDriver 和动态 Shell locator，删除 Renderer 中固定 executable/cwd 默认值。
4. 引入 LocalFileService、Policy 和九个 Tool Schema。
5. 完成模型能力 validation、独立模型页面、中文 UI 和可见错误。
6. 运行全量单元、集成、真实 HTTP、ConPTY、Electron 和 packaged E2E。
7. 生成 `0.2.0` 安装包；安装器继续阻止活动 Session 上升级并在 schema migration 前备份。

回滚到 `0.1.0` 时必须先退出 Core，并恢复迁移前数据库备份。v0.2.0 新增 Conversation 数据不会被旧版本读取。

## Open Questions

无阻塞开放问题。用户已授权实现方自行决策，并要求完成现有 change、真实模型配置和 `ssh example-host` 只读验证。
