## Why

当前 MVP 已具备 PTY、Session、Provider Adapter 和四个 Terminal Tool 的骨架，但真实试用暴露出关键行为缺口：POSIX 探测会误写入 PowerShell，Provider 测试与 Agent 失败不可见，Tool Call/Tool Result 不能可靠跨 Provider 续接，Agent 也缺少多轮对话和本机文件能力。本变更将这些能力升级为可真实使用、可恢复、可审计的 Agent Runtime v2。

## What Changes

- **BREAKING** 重构 Provider 中立消息模型和 Agent 循环，保留标准 Tool Calling，但正确保存 assistant tool call 与 tool result，使模型可自主迭代直到完成、等待审批、等待用户、失败或取消。
- **BREAKING** 将模型连接拆分为 `Provider Profile` 与 `Model Configuration`：前者只保存协议、端点和凭据引用，后者引用 Provider 并保存模型 ID、上下文、能力、启用状态、默认状态和验证结果。
- 允许 Agent 在不调用 Tool 时进行普通多轮对话；终端内容不再默认随每条消息发送，只有模型调用终端观察 Tool 时才披露。
- 将模型可见 Tool 固定为协议安全名称：`terminal_observe`、`terminal_execute`、`terminal_wait`、`terminal_interrupt`，以及 `local_list_files`、`local_search_files`、`local_read_file`、`local_write_file`、`local_edit_file`。
- 新增 POSIX、PowerShell 和仅观察 ShellDriver；ShellProbe 改为执行前惰性、按方言探测，禁止在普通对话或 PowerShell 中注入 POSIX 语法。
- 新增当前用户主目录范围的本机文件 Tool，生产代码动态解析用户目录，不写死用户名、盘符、Git Bash 或系统组件路径。
- 普通本机文件可由 Agent 自主创建和编辑；敏感文件、凭据、启动项和高影响路径由本地策略要求确认，并记录前后哈希和审计。
- 新增独立“模型”功能页面，分别管理 Provider Profile 与 Model Configuration；支持模型配置 CRUD、启用/停用、默认模型、连接与 Tool 能力检测及明确失败原因。
- 在“模型配置”视图中为选定 Provider 通过 `/v1/models` 拉取有界模型列表，使模型 ID 可从下拉列表快速选择；Provider 连接视图只管理连接，模型检测是独立诊断，不作为启用、默认或保存前置条件。
- Agent composer 从已启用的 Model Configuration 列表中选择；Turn 启动后固定所选配置版本并记录解析后的 Provider、模型 ID 和能力快照，未检测模型的运行错误保持可见。
- 桌面端全部用户可见产品文案改为简体中文；命令、终端原始输出、模型回复、模型 ID、协议名和必要技术错误保留原文。
- 动态发现 Git Bash、PowerShell 和 WSL，并在 Session 创建界面显示可用性和真实启动路径来源。
- 新增 Agent Conversation/Turn 持久化、流式消息聚合、可恢复 Tool 错误、循环上限和明确失败时间线。
- 对已经调用过 Tool 的任务新增有界完成性复核：首次无 Tool 文本只作为候选答案且不进入复核模型上下文，模型必须基于原目标和实际 Tool 证据复核；若仍有缺口则继续调用现有 Tool，确认完成后发布完整、自包含的最终答案。纯聊天不增加额外模型调用。
- 新增可配置 Context Window、输出预留和自动 Conversation Compaction；旧消息原文继续保留，模型上下文使用持久摘要与近期精确消息，推理强度统一为 `low | medium | high | xhigh`。
- 新增 `manual`、`auto`、`full_access` 三种 Permission Mode。完全权限仅取消审批提示，不扩大 Tool、Session 或本机文件边界。
- 重构桌面工作区为顶部多 Session 终端标签、主终端区与可关闭的右侧资源/Agent 面板，不保留左侧 Session 列表；支持 Markdown 时间线、自适应/明亮/暗黑主题、模型与推理强度切换，并确保明亮主题下 xterm 前景、ANSI 颜色、光标和选区保持可读对比度。
- 新建 Session 默认直接进入当前用户 home，标准界面不再要求用户理解或填写 working directory。
- 新增通过当前 Ready Session 显式采集的只读 CPU、内存、磁盘、网络、主机和 uptime 资源快照，不引入 SSH 或服务器资产模型。
- 版本升级为 `0.2.0`，完成真实 Electron -> Main -> Named Pipe -> Core -> ConPTY、真实本机文件 Tool、真实本地 HTTP Provider 和打包程序端到端测试。

## Capabilities

### New Capabilities

- `local-file-tools`: 当前用户主目录内的本机文件发现、读取、创建、原子编辑、敏感路径审批和审计边界。
- `session-observability`: 通过当前 Terminal Session 显式、只读采集服务器或本机资源快照并在桌面端展示。

### Modified Capabilities

- `agent-execution`: 从单次目标执行升级为可纯对话或自主循环调用 Terminal/本机文件 Tool 的 Session 多轮 Agent Runtime，并增加 Context Budget、自动压缩、模型/推理设置和 Permission Mode。
- `terminal-sessions`: 增加动态 Shell 启动发现、执行方言、惰性 ShellDriver 探测和 PowerShell 结构化命令事务。
- `model-providers`: 拆分 Provider Profile 与 Model Configuration，增加模型目录、默认/启用状态、Provider 中立结构化 Tool 消息、协议安全 Tool 名称、明确能力测试结果、总超时、Context Window 和推理强度映射。
- `desktop-terminal`: 增加独立模型管理页面、完整简体中文界面、Shell 可用性、执行方言、多轮 Markdown 时间线、主题、Agent 模型选择、资源面板和可见 Provider/Agent 错误。
- `terminal-safety-audit`: 将策略、审批和审计扩展到本机文件、三种 Permission Mode、资源快照和上下文压缩。

## Impact

- 主要影响 `apps/core` 的 AgentRuntime、AgentCoordinator、Provider Adapter、ShellProbe、CommandExecutor、ToolGateway、仓储和数据库迁移；完成性复核的候选文本只保留在活动 Turn 内存中，不进入 Timeline 或持久化历史。
- 主要影响 `apps/desktop` 的顶层导航、独立模型页面、Session 创建、Agent 面板、错误显示、中文文案和 Electron 窗口菜单策略；原生应用菜单将被移除。
- 新增 Session 资源快照 API、主题与对话偏好持久化；资源采集只能执行固定只读命令且必须由用户显式刷新。
- 影响 `packages/domain` 与 `packages/protocol` 的 Provider Profile、Model Configuration、Agent Model Selection、Conversation、Turn、结构化 Model Item、Tool Schema、Shell 方言和本机文件操作类型。
- 新增用户主目录文件边界、路径规范化、原子写入和敏感文件策略；Renderer 仍不能直接访问 Node.js 文件系统。
- 现有内嵌模型字段的 Provider Profile 迁移为一个连接 Profile 和一个对应 Model Configuration；凭据引用与审计保留，历史 Agent Task 作为只读记录保留，新 Turn 写入固定模型选择快照。
- E2E 将使用本地测试 Provider，不要求真实外部 OpenAI 或 Anthropic 凭据；外部真实服务仍由用户配置验证。
