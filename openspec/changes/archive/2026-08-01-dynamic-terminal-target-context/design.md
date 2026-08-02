## Context

当前 Core 已有 `SessionActor`、`ShellProbe`、明文 `PlaintextShellDispatcher`、`AgentCoordinator` 和 `ContextBuilder`，也已经维护 dialect、platform、verification status 与 capability epoch。但实际链路存在三个断点：

1. Shell Probe 只识别 `posix`/`powershell`，成功后会以旧 hint 或 `unknown` platform 标记环境已验证；因此 `bash` on Windows Git Bash 与 Linux Bash 对模型不可区分。
2. Agent Runtime 在环境 Probe 前就生成第一轮模型请求，`sessionSummary` 只有 Session ID；人工审批发生在环境准备之前，模型无法依据当前目标环境选择命令。
3. Approval timeline 同时使用 approval id 和 toolCallId，Desktop 合并时可能把 approval 状态并入 Tool 卡片；全局错误弹层又会遮挡取消按钮，导致旧审批点击和任务取消都表现为无效或报错。

本 change 不创建 SSH、堡垒机或容器连接领域对象。当前目标始终是同一个 PTY；环境身份由该 PTY 的有界 Probe 在需要结构化执行时重新确认。

## Goals / Non-Goals

**Goals:**

- 从当前 PTY 得到可验证的操作系统族（Windows、Linux、macOS）、粗粒度平台、Shell dialect、验证时间和 capability epoch。
- 在 Agent 首次请求模型前完成环境准备，并把脱敏、有限的当前环境摘要传给模型；环境切换、接管或重连后重新准备。
- 保证资源监控和明文命令 dispatch 使用当前已验证环境，不让 POSIX 语法被误当作 Linux 能力。
- 使 Approval Grant 与精确 Tool Call、命令和环境 epoch 绑定；目标环境变化后旧审批失效且 UI 不再显示可操作按钮。
- 修复 approval、tool、command、result 的时间线身份合并，并保证等待审批、Probe 或模型运行期间的取消可完成。
- 用单元、集成和桌面回归测试覆盖 Windows Git Bash、Linux/macOS、SSH/容器切换、错误审批和取消任务。

**Non-Goals:**

- 不枚举或缓存目标机器上的所有可执行文件，也不为任意模型命令建立通用命令能力数据库。
- 不解析 SSH 跳转、堡垒机或容器拓扑；只记录当前 PTY 的可验证环境。
- 不改变 Permission Mode 的安全语义；manual mode 仍可要求每个新的 Tool Call 审批。
- 不把命令执行失败自动视为成功，也不通过自动重试相同命令绕过审批。

## Decisions

### 1. 在现有 environment model 上增加操作系统族

保留现有 `platform: windows | unix | unknown` 作为 Shell/资源 dispatch 的粗粒度边界，增加 `operatingSystem: windows | linux | macos | unknown` 用于模型上下文和平台相关诊断命令。旧数据库记录通过 schema default 归一化为 `unknown`，不新增连接拓扑字段。

选择增加字段而不是扩大 `platform` 枚举，是为了保持现有 POSIX dispatch、资源协议和测试兼容，同时让 macOS 与 Linux 不再被模型混为一谈。

### 2. 复用两阶段明文 Probe，并让第二阶段输出平台标记

保留现有跨方言 dialect fingerprint。识别 dialect 后，使用对应 Shell Driver 的固定只读 Probe：POSIX 读取 `uname -s`，PowerShell 使用受支持的运行时 OS 信息，输出带 nonce 的固定标记；ShellProbe 只接受匹配 nonce、成功完成事件和受支持 OS 值。

选择固定 Probe 而不是让模型执行 `uname`、`free` 或 `Get-Command`，因为 Probe 必须在环境未验证时仍可审计、无副作用且不依赖模型的猜测。未知或歧义环境保持 observation-only。

### 3. 模型启动前准备环境，并以文本摘要注入上下文

`AgentCoordinator` 在创建 `AgentRuntime` 前确保当前 lease 和 environment 已验证，然后把如下有限摘要放入 `ContextBuilder` 的 `sessionSummary`：dialect、platform、operatingSystem、verificationStatus、capabilityEpoch 和 verifiedAt。System prompt 明确要求把该摘要视为当前 PTY 事实，不从宿主机、Shell 名称或历史输出推断 OS。

选择在模型启动前 Probe，是为了避免模型先生成审批请求、审批后才发现环境未知。模型上下文仍然是提示信息，最终写入前由 Dispatcher 的 environment/epoch 校验兜底。

### 4. Approval 绑定 environment epoch，取消是独立的控制路径

Approval Grant 和 PendingApproval 增加 environment epoch。创建授权、恢复 checkpoint 和执行命令时必须匹配当前 epoch；用户输入、接管、重连或环境 Probe 失败会使旧授权不可用。取消请求不依赖模型是否正在等待 Provider、Tool Result 或 Approval，Core 先清除 pending approval、发出取消时间线事件，再取消 runtime 并结束 task。

选择 epoch 绑定而不是仅比较命令文本，是因为相同的 `free -h` 在不同 PTY 目标上含义和可用性不同；选择独立取消路径，是为了不把取消错误地当作审批拒绝或等待模型恢复。

### 5. Timeline 以事件 id 优先、toolCallId 只用于 Tool 事件聚合

Desktop `upsertTimelineEvent` 先按稳定 `event.id` 更新同类型事件。只有 Tool、Command、Result 事件才使用 `toolCallId` 聚合；Approval 事件即使引用同一个 toolCallId，也必须保持自己的卡片和生命周期。历史恢复不得把已结束的 live approval 重新变成 actionable。

Approval 卡片只在 `waiting_approval` 时作为独立交互面显示。完成、取消或环境失效事件仍写入 live state 以支持稳定 id 更新，但不再渲染为独立终态卡片；对应命令和结果由 Tool 卡片承载，避免同一操作在时间线中出现两份。

### 6. 过期审批错误不遮挡取消操作

服务端仍拒绝真正失效的 approval id，但 UI 对 `approval_invalid`/已结束审批应刷新当前历史并标记旧卡片不可操作，而不是留下全屏阻塞错误弹层。取消按钮在 active task 存在时保持可用，并以当前 Session 的活动 task 为目标；请求完成后由 Core 的取消事件清除 active turn。

### 7. Probe 完成处理必须幂等

Shell Probe 在收到匹配完成帧后先锁定本轮完成处理，再异步执行 shell 状态转换和环境校验。交互式 Shell 可能重复回显同一 OSC 完成帧；后来的重复帧不得再次执行 `ready` 转换并把已成功的 Probe 变成 `invalidated`。

### 8. 非终端 Agent 任务归还 lease 但保留环境事实

模型启动前的环境准备可能暂时取得 PTY lease。若本轮只进行了对话、观察或本机文件操作，没有终端命令或终端审批，则将 lease 归还给用户并保留已验证环境；真实终端命令、待审批终端操作、Probe 失败或交互接管仍使环境失效并要求下一轮重新 Probe。资源刷新在环境身份未知时先重新取得 lease 并完成 Probe，再执行固定只读命令。

## Risks / Trade-offs

- [精简环境没有 `uname` 或 PowerShell OS 变量不可用] → Probe 返回 observation-only，禁止 Agent 结构化执行，并提示用户观察或接管；不猜测平台。
- [交互 Shell 输出污染 Probe 标记] → 使用 nonce、严格标记格式和 OSC 完成事件，未同时满足时不转为 ready。
- [模型启动前 Probe 增加首轮延迟] → 使用共享 deadline 和短小固定 Probe；失败时避免进入更昂贵的模型/审批循环。
- [旧数据库缺少 operatingSystem] → 协议 schema 使用 `unknown` 默认值；旧记录不会被当作已验证环境。
- [审批完成事件与历史请求乱序] → 以稳定 approval id 合并，并在 UI 侧对 terminal approval 状态隐藏操作控件。
- [取消和 Provider/Probe 完成存在竞态] → Core 以 Session state identity、task status 和 pending approval 清理作为幂等边界；晚到的 runtime 结果不得重新建立活动 task。

## Migration Plan

1. 先扩展 domain/protocol environment 类型和 schema default，保持旧记录可读取。
2. 增强 Shell Driver/ShellProbe 的 OS fingerprint，并在 AgentCoordinator 运行模型前准备环境和注入摘要。
3. 扩展审批 scope/epoch 校验，修复 Coordinator cancel 和 Desktop timeline/error 处理。
4. 运行定向 TDD、Core 全量测试、Desktop 类型检查和构建；再运行相关 Electron/Playwright 回归。

回滚时可恢复代码变更；新增字段使用默认值，不需要破坏性数据库迁移。若 Probe 在某平台不兼容，安全表现为 observation-only，而不是回退到旧的未验证命令路径。

## Open Questions

- 是否在后续 change 中增加按目标环境探测任意命令可用性的独立能力目录？本 change 明确不做，以免把一次性环境 Probe 扩大为命令执行器。
