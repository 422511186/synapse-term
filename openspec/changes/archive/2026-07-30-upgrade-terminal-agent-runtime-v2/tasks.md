## 1. 回归基线与领域协议

- [x] 1.1 以失败测试复现 PowerShell Session 收到 POSIX ShellProbe、普通对话任务失败但 UI 无错误、Git Bash 不在 PATH 时 Session 创建失败和模型检测无文字反馈。
- [x] 1.2 以失败测试定义 `AgentConversation`、`AgentTurn`、结构化 `ModelItem`、`ToolCallRecord`、execution dialect 和状态转换。
- [x] 1.3 以失败测试定义九个 Provider 可见 Tool 的 Zod Schema，确认名称使用下划线、参数不含 `sessionId` 或本机根目录、未知字段 fail closed。
- [x] 1.4 实现共享 domain/protocol 类型、稳定错误码、IPC request/event schema 和版本升级。
- [x] 1.5 以失败迁移测试新增 Conversation、Turn、Model Item、Tool Call 与 Session dialect 持久表/字段，并验证 v0.1.0 数据备份、迁移和旧任务只读保留。
- [x] 1.6 以失败领域/协议测试拆分 `ProviderProfile`、`ModelConfiguration` 与 `AgentModelSelection`，定义 Provider 1:N 模型、eligible/default 不变量和 Turn 不可变快照。
- [x] 1.7 以失败迁移测试将旧 Provider 内嵌的 model/context/capability/validation 字段迁移为独立 Model Configuration，并保留凭据引用、历史任务和回滚备份。

## 2. Agent Runtime v2

- [x] 2.1 以失败测试证明纯文本模型轮次可直接完成，不调用 Tool、不获取 Session Lease、不运行 ShellProbe且不写 PTY。
- [x] 2.2 以失败测试实现 assistant tool call -> Tool Result -> 下一轮模型 -> 最终文本的结构化循环。
- [x] 2.3 以失败测试实现 Session Conversation 多轮历史、重置语义、有界历史和 SecretRedactor。
- [x] 2.4 以失败测试实现可恢复 Tool 错误回送模型、fatal 错误终止和错误原因持久化/时间线事件。
- [x] 2.5 以失败测试实现 Model Run、Tool Call、总时长和重复无进展调用上限。
- [x] 2.6 以失败测试实现多 Tool Call 按 Provider 顺序串行执行，以及审批/接管/副作用阻塞后续调用。
- [x] 2.7 实现 Agent Runtime v2、Conversation Coordinator、Turn 调度和版本化 ContextBuilder 系统提示词契约，覆盖 Session 绑定、Tool 使用条件、证据优先、安全边界、交互式接管、错误恢复和最终回复结构；删除“只能调用终端工具”和默认终端屏幕披露。
- [x] 2.8 实现稳定 ID 的 assistant 流式聚合事件，避免每个 delta 单独成条和最终答案重复。

## 3. 模型目录、Provider Adapter 与能力测试

- [x] 3.1 以失败契约测试定义 OpenAI Responses function call/`function_call_output` 第二轮请求形状。
- [x] 3.2 以失败契约测试定义 Chat Completions assistant `tool_calls`/role=`tool` 第二轮请求形状。
- [x] 3.3 以失败契约测试定义 Anthropic `tool_use`/`tool_result` 第二轮请求形状。
- [x] 3.4 实现 Provider 中立 Model Item 映射、协议安全 Tool 名称和三种官方 SDK Adapter。
- [x] 3.5 以失败测试实现 `ModelCatalogService` 的 Provider 1:N 模型 CRUD、引用完整性、启用/停用、唯一 eligible 默认模型和 Provider 变更批量失效。
- [x] 3.6 实现独立 Provider/Model 仓储、Core API 与 Adapter 解析，确保 Renderer 永远不接收凭据值且 Agent 只提交 `modelConfigurationId`。
- [x] 3.7 以失败测试要求 Model Configuration Probe 必须观察到 streaming 和指定 Tool Call，不能因任意首事件标记 available。
- [x] 3.8 以失败测试实现模型 validation 单飞、总超时、取消、结构化能力、checkedAt、attempt 和失败原因。
- [x] 3.9 实现连接、TLS、鉴权、模型、协议、缺少 Tool Call 和 URL scheme 的稳定错误映射及中文建议。
- [x] 3.10 建立真实本地 OpenAI-compatible HTTP/SSE 测试 Provider，使用官方 `openai` SDK 完成测试 Probe、纯聊天和多轮 Tool Loop。
- [x] 3.11 以失败契约测试实现 OpenAI/compatible 与 Anthropic Models API 拉取，覆盖 `/v1/models`、鉴权、分页、去重、500 条上限、超时、取消、unsupported 和游标循环。
- [x] 3.12 实现 `ProviderModelDiscoveryService`、脱敏 IPC 结果和按 `(providerProfileId, modelId)` 的唯一性保护；由发现结果新建的配置固定为 disabled/unverified。

## 4. ShellDriver、Session 方言与动态发现

- [x] 4.1 以失败测试定义 `ShellDriver` 接口、按 dialect 选择、惰性 capability epoch 和 observe-only 拒绝执行。
- [x] 4.2 将现有 POSIX Probe/Command wrapper 迁移到 `PosixShellDriver`，保持引号、状态、OSC nonce 和集成测试。
- [x] 4.3 以失败单元/性质测试定义 PowerShell 命令编码、完成事件、异常、`$LASTEXITCODE`、`Set-Location` 和变量状态。
- [x] 4.4 实现 `PowerShellDriver` 并在真实 ConPTY 中验证成功、失败、持续输出、状态保持和 Ctrl+C。
- [x] 4.5 以失败测试证明普通对话和 `terminal_observe` 不 Probe，PowerShell 执行不出现 `eval`、`printf`、`unset`。
- [x] 4.6 以失败测试实现 Session execution dialect 持久化、IPC 修改、人工输入使 capability epoch 失效和下一次执行重新 Probe。
- [x] 4.7 以失败测试实现动态 `HomeResolver` 和 `ShellLocator`，覆盖 PATH、Git 注册表、环境构造位置、`SystemRoot`、不可用 Shell 和非默认盘符。
- [x] 4.8 实现 Electron Main Shell descriptor API、动态默认 cwd 和 Core 解析，删除 Renderer 中固定 `bash.exe`、`powershell.exe`、`wsl.exe` 与 `C:/Users` 假设。

## 5. Terminal Tool v2

- [x] 5.1 以失败测试定义 `terminal_observe` screen/output 模式、cursor、history gap、active transaction 和有界结果。
- [x] 5.2 以失败测试定义 `terminal_execute` 的 JIT Lease、ShellDriver Probe、审批、completed/running/interaction/error 结果。
- [x] 5.3 以失败测试定义 `terminal_wait` 的增量 cursor、超时和最终退出状态。
- [x] 5.4 以失败测试定义 `terminal_interrupt` 只能中断当前 Session/Turn 的活动 Transaction。
- [x] 5.5 实现 TerminalToolGateway v2、provider-visible/internal name mapping、可恢复错误和完整 Tool 审计。
- [x] 5.6 集成 Approval 恢复，使批准后的原 Tool Call 得到实际执行结果并继续下一轮模型，而不是丢失 call/result 关系。

## 6. 本机文件边界与 Tool

- [x] 6.1 以失败测试实现动态当前用户 home root、相对路径校验、大小写规范、绝对/UNC/设备/ADS/NUL/`..` 拒绝。
- [x] 6.2 以失败测试覆盖 symlink、junction、reparse point、现有路径 realpath 和新文件最近存在父目录逃逸。
- [x] 6.3 以失败测试实现 `local_list_files` 的稳定排序、类型、大小、mtime、深度和结果上限。
- [x] 6.4 以失败测试实现 `local_search_files` 的文件名/文本模式、深度、结果、读取字节、超时和取消边界。
- [x] 6.5 以失败测试实现 `local_read_file` 的 UTF-8/UTF-16 BOM、行/字节范围、SHA-256、截断和二进制拒绝。
- [x] 6.6 以失败测试实现 `local_write_file` create/replace、expected SHA-256、同目录临时文件、flush、原子替换和 conflict。
- [x] 6.7 以失败测试实现 `local_edit_file` 多个精确 oldText/newText、匹配数量、expected SHA-256、全有或全无和 recoverable conflict。
- [x] 6.8 实现 `LocalFileService`、五个 Tool、结果脱敏和 Runtime 集成，确认本机路径不受 Terminal cwd/SSH 状态影响。
- [x] 6.9 以失败测试实现 `LocalFilePolicy`，覆盖普通自动写入、`.ssh`、`.env*`、云/Kubernetes/包管理器凭据、浏览器 Profile、Startup 和 PowerShell Profile。
- [x] 6.10 实现本机文件审批绑定、Diff、前后哈希、审计和 fail-closed 路径/哈希错误；确认没有 delete/move/chmod/registry Tool。

## 7. 简体中文桌面体验

- [x] 7.1 建立集中 `zh-CN` 文案与错误码映射，先以失败测试覆盖顶栏、Session、Agent、Provider、审批、接管、审计、状态栏和空状态。
- [x] 7.2 将 Renderer 全部用户可见产品文案改为简体中文，使用 `Menu.setApplicationMenu(null)` 并关闭 BrowserWindow 菜单栏可见性，保留命令、路径、终端输出、模型回复和协议专有名词。
- [x] 7.3 以失败 UI 测试实现动态 Shell 可用性、解析来源、默认 home cwd、创建错误和 execution dialect 控件。
- [x] 7.4 以失败 UI 测试实现 Session 多轮 Conversation、eligible 模型选择、无可用模型阻断、发送中固定选择、流式聚合、Tool 活动、错误 system item、重置对话和取消。
- [x] 7.5 以失败 UI 测试实现顶层独立“模型”页面及“模型配置/Provider 连接”视图，不再使用 Provider 设置弹窗或在 Agent panel 编辑配置。
- [x] 7.6 以失败 UI 测试实现 Provider 1:N 模型 CRUD、启用/停用、默认模型、引用删除阻断、模型检测状态/能力/时间/原因、HTTP 警告和重复点击阻止。
- [x] 7.7 以失败 UI 测试实现模型配置视图的“拉取模型”、Provider 选择、可搜索模型 ID 下拉、手动输入回退、加载/取消/失败状态和待检测标识；Provider 连接视图不显示拉取操作。
- [x] 7.8 以失败 UI 测试实现本机文件 Tool 路径、状态、Diff、敏感审批和结果摘要。
- [x] 7.9 校正 Core connected/offline 与 Session/Turn 状态同步，使后台 Core 或请求失败不会显示互相矛盾的状态。

## 8. Core 集成与安全验证

- [x] 8.1 使用 fake Provider 完成纯聊天、多轮历史、终端 observe/execute/wait、可恢复错误调整和最终回复集成测试。
- [x] 8.2 使用 fake Provider 完成本机文件 read/edit 后执行终端命令的混合任务，并验证 Tool 顺序和审计关联。
- [x] 8.3 覆盖危险终端命令、敏感文件 read/edit、审批篡改、stale lease、路径逃逸和 Renderer 绕过安全测试。
- [x] 8.4 覆盖 UI 断开、Provider 中断、活动命令自然结束、Turn suspended、用户接管和恢复流程。
- [x] 8.5 覆盖 20 Session、4 并发 Turn、大输出、大文件、慢 Provider、慢 UI 和文件搜索取消的有界资源测试。
- [x] 8.6 覆盖模型配置在 Turn 创建前失效、运行中修改/停用、历史后删除、Provider 更新批量失效和默认模型竞争的 Core 集成测试。

## 9. 真实端到端测试

- [x] 9.1 扩展 Playwright 浏览器 Mock 测试，覆盖中文布局、独立模型页面、Provider 1:N 模型、模型配置视图的 `/v1/models` 拉取与模型 ID 下拉、默认/启用状态、英文推理强度、普通聊天、Terminal Tool、Local File Tool、模型成功/失败和审批交互。
- [x] 9.2 在真实 Electron -> Main -> Named Pipe -> Core -> ConPTY 链路验证 PowerShell 普通聊天不写 Probe、PowerShell Driver 命令循环和 Git Bash POSIX 命令循环。
- [x] 9.3 在真实 Electron 链路连接本地 HTTP Provider，验证模型配置视图的 `/v1/models` 拉取/选择、官方 SDK streaming、至少两轮 Tool Call/Result 和最终自然语言答案。
- [x] 9.4 使用临时注入的测试 home 在真实 Core 中验证 list/search/read/create/edit、hash conflict、敏感审批和 home 逃逸拒绝。
- [x] 9.5 验证 Agent 可在一个 Turn 中读取本机脚本、编辑文件、在 Terminal Session 执行命令、等待输出并给出最终结论。
- [x] 9.6 采集 1440x900 与 980x640 中文桌面截图，断言无横纵溢出、文本重叠、不可见按钮或英文产品文案遗漏。
- [x] 9.7 构建 `release/win-unpacked`，运行 packaged Electron E2E，验证固定 Node Runtime、真实 Provider、ConPTY 和 Local File Tool。
- [x] 9.8 构建并静默安装 `0.2.0` NSIS 安装包，在安装目录运行真实 E2E，验证升级阻断、备份、回滚入口和卸载保留策略。

## 10. 文档、验证与发布

- [x] 10.1 更新 README、架构、安全边界、运行手册和模型配置，说明 Provider 1:N 模型、`/v1/models` 快速配置、独立模型页面、Agent 选模、九个 Tool、execution dialect、用户 home 文件范围和真实外部凭据测试边界。
- [x] 10.2 更新 Requirement-to-Test 验证矩阵和发布报告，记录每条 delta requirement 的自动化或人工证据。
- [x] 10.3 将版本更新为 `0.2.0`，生成安装包 SHA-256、视觉证据和升级/回滚结果。
- [x] 10.4 运行 `pnpm format:check`、lint、typecheck、全部 Vitest、Provider HTTP、ConPTY、Playwright、packaged、security、performance 和 installer 测试。
- [x] 10.5 运行 `openspec validate upgrade-terminal-agent-runtime-v2 --strict` 与 `openspec validate --all --strict`，修复所有 placeholder、矛盾和未覆盖需求。
- [x] 10.6 完成代码审查、自查无硬编码用户/盘符路径、确认工作区变更可追溯，并生成归档就绪报告。

## 11. Context Budget、压缩与 Turn 设置

- [x] 11.1 以失败领域/协议测试定义 `ContextWindowConfig`、`ConversationCompaction`、`reasoningEffort`、Turn Model Configuration 选择快照和兼容迁移。
- [x] 11.2 以失败测试实现 Token 估算、系统/输出/Tool headroom、压缩阈值和超限 fail closed。
- [x] 11.3 以失败测试实现 Provider 摘要与确定性 fallback，持久化摘要来源序号并保留原始 Model Item。
- [x] 11.4 扩展 OpenAI Responses、Chat Completions 和 Anthropic Adapter 的 max output/reasoning 参数能力映射，不向不兼容端点发送未知字段。
- [x] 11.5 以 Core 集成测试验证长对话自动压缩、压缩后 Tool 关联、多轮继续、重置 Conversation 和取消恢复输入。
- [x] 11.6 在独立模型页面暴露 context window、最大输出、压缩开关/阈值和能力，在 Agent composer 只暴露 eligible 模型与推理强度，并完成中文校验。

## 12. Permission Mode

- [x] 12.1 以失败领域/协议测试定义 `manual | auto | full_access`、Conversation 持久化、IPC 修改和审计事件。
- [x] 12.2 将本机普通 write/edit 正确分类为 mutating，并以矩阵测试实现三种模式对 read-only、mutating、unknown、privileged、destructive 和敏感读取的审批决策。
- [x] 12.3 证明 `full_access` 仍无法绕过 Tool allowlist、Session 绑定、home 路径、SecretRedactor、expected hash、Lease 和 Schema。
- [x] 12.4 在 Agent composer 增加中文 Permission Mode 控件、危险说明和活动审批不追溯升级行为。
- [x] 12.5 扩展 Timeline 与审计，记录模式、策略、风险、自动批准或显式 Grant，并完成 Renderer 绕过测试。

## 13. 资源快照与工作区重构

- [x] 13.1 以失败协议测试定义 `SessionResourceSnapshot`、刷新 request/result、指标不可用和稳定中文错误。
- [x] 13.2 实现 POSIX 与 PowerShell 固定只读资源命令、解析器、Session 空闲/方言/Lease 检查、超时和有界原始输出。
- [x] 13.3 以 fake PTY 和真实 ConPTY 测试 CPU、内存、磁盘、网络、host、OS、uptime、部分命令缺失和交互状态拒绝。
- [x] 13.4 重构桌面为顶部多 Session 终端标签、主终端区和可关闭右侧资源/Agent 面板；删除左侧 Session rail，关闭右面板时终端必须占满宽度，新建 Session 只显示名称和 Shell，cwd 固定动态 home。
- [x] 13.5 引入安全 Markdown/GFM 时间线渲染、代码块/表格样式、稳定流式聚合和链接安全策略。
- [x] 13.6 使用 CSS 语义变量实现 `system | light | dark`，持久化偏好并同步 xterm theme，以对比度测试覆盖明亮主题前景、ANSI white/brightWhite、光标和选区。
- [x] 13.7 以 Playwright 覆盖 1440x900、980x640、390x844 的三主题、顶部多 Session 标签、右侧资源/Agent 面板、关闭面板后终端占满宽度、长中文、Markdown和无重叠/溢出。

## 14. 真实模型与 SSH 只读验收

- [x] 14.1 使用用户已保存的 Provider Profile 与其 Model Configuration 完成真实模型检测、普通聊天、流式 Markdown 和至少两轮 Tool Call/Result，不读取或输出 API Key。
- [x] 14.2 通过真实 Electron Session 使用本机已有 SSH 配置连接 `example-host`，不在产品中建模主机或连接拓扑。
- [x] 14.3 在 `manual` Permission Mode 下让 Agent 仅执行主机、uptime、CPU、内存、磁盘和网络只读诊断；任何写命令、写文件或批准请求均使测试失败。
- [x] 14.4 刷新并验证 `example-host` Session Resource Snapshot，与只读命令证据交叉检查关键指标。
- [x] 14.5 导出该验收的 Timeline、命令风险与审计摘要，确认目标服务器配置、文件和数据均未修改。
- [x] 14.6 将真实模型、SSH、packaged 和 installer 证据纳入发布报告与 Requirement-to-Test 矩阵。

## 15. 跨方言命令风险与 Permission Mode 全链路补强

- [x] 15.1 以失败测试证明当前 POSIX-only PolicyEngine 会把 PowerShell 只读、普通变更、提权和破坏性命令全部误判为 `unknown`，并定义按 Session execution dialect 分类的期望矩阵。
- [x] 15.2 实现 dialect-aware Terminal 命令风险分类；POSIX 行为保持兼容，PowerShell 识别只读 Cmdlet、常用别名、普通变更、unknown、privileged 和 destructive，ToolGateway 在每次执行时读取当前 Session 方言并完整审计。
- [x] 15.3 扩展真实 packaged Electron UI E2E，在临时用户 home 和 PowerShell ConPTY 中验证 `manual | auto | full_access` 与 read-only/mutating/unknown/privileged/destructive 的执行、审批、取消、副作用和审计关联。
- [x] 15.4 运行 `pnpm verify`、全量 Playwright、packaged/installer 生命周期及 OpenSpec strict 校验，更新验证矩阵、发布报告和可追溯证据。

## 16. Tool 任务完成性复核

- [x] 16.1 以失败 Runtime 与 Coordinator 测试复现模型在只完成部分 Tool 子目标后输出最终文本，要求 Turn 不得完成、候选文本不得进入 Timeline 或持久化历史，并验证纯聊天仍只调用模型一次。
- [x] 16.2 实现通用且有界的 post-Tool completion review：复用当前 Turn 的模型快照、原目标与结构化 Tool 证据，缺口继续现有 Tool Loop，确认后只发布一次最终答案；复核计入 Model Run/时长上限并支持取消、断连与审批恢复。
- [x] 16.3 扩展单元、Core 集成和 packaged Electron E2E，覆盖复核继续调用 Tool、复核确认、复核次数耗尽、候选文本缓冲、最终 Timeline/SQLite 唯一持久化及普通对话无额外调用。
- [x] 16.4 使用已保存模型配置重新执行 `ssh example-host` 只读验收，确认七条白名单诊断命令全部执行、零审批、零写操作；随后重跑 `pnpm verify`、全量 Playwright、packaged/installer 与 OpenSpec strict，更新证据、报告、安装包哈希并完成 15.4。

## 17. 真实使用回归修复与工作区交互优化

- [x] 17.1 以失败领域、协议、Core 和 Renderer 测试定义模型启用、停用、默认选择与 validation 相互独立，保存连接相关字段只重置检测结果而保留启用和默认意图。
- [x] 17.2 实现模型目录、Core API、协议 Schema、浏览器 Mock 与 Agent composer 的独立模型状态语义，确保未检测或检测失败的已启用模型仍可选择且运行错误明确可见。
- [x] 17.3 以失败测试复现 PowerShell Session 经人工 `ssh` 进入 POSIX 环境后仍注入 PowerShell Probe，并定义 capability epoch 失效后的有界、只读 Shell 方言指纹识别。
- [x] 17.4 实现不建模 SSH 拓扑的自动方言识别、Session 方言持久同步和正确 ShellDriver Probe，禁止向 POSIX 远端写入 PowerShell 包装代码。
- [x] 17.5 以失败策略、Coordinator、Scheduler 和时间线测试定义 `manual` 下每个 Terminal 命令均审批、同 ID 审批终态事件以及交互完成后释放 Session 活动 Turn。
- [x] 17.6 实现人工审批卡片批准/拒绝终态、交互/接管后的任务收敛和重复发送保护恢复，消除残留 active Agent Task。
- [x] 17.7 以失败 UI 测试定义资源面板折叠、固定紧凑 composer 底栏、Agent 侧栏拖拽宽度、可读字号、近底部自动滚动及 live/history 一致的紧凑可折叠 Tool 时间线。
- [x] 17.8 实现工作区和时间线 UI/UX 优化，确保资源区折叠后聊天占满高度、控件不随输入框移动、Agent 文字清晰可读且历史 Tool 结果不过度占据页面。
- [x] 17.9 运行目标测试、typecheck、完整自动化验证、OpenSpec strict 校验并重新构建 `release/win-unpacked`，记录新可执行文件及 SHA-256。
