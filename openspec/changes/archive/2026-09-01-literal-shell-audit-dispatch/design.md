## Context

当前分支的 `CommandExecutor` 直接按 `terminalType` 构造 POSIX/PowerShell 包装器，再通过 `SessionActor.writeUser()` 写入 PTY。POSIX 包装器使用 `__synapse_command=...; eval ...`，而 `develop` 的 `PlaintextShellDispatcher` 虽然移除了 Base64 与 `eval`，仍通过 POSIX brace group 或 PowerShell dot-source 包装用户命令。两种实现都能取得退出码并保持 Shell 状态，但目标机器审计到的是包装后的 PTY 输入，不是用户原始命令。

本变更需要在不破坏现有 Session 语义、MCP 审批、输出脱敏和本地输入可用性的前提下，采用 `develop` 中有价值的分层思路：Shell Driver 负责方言，Main 负责控制帧隔离，执行器负责事务收敛。现有产品仍然是单用户、本地优先、传输无关的本地 PTY Session；不能为 SSH、跳板机、容器或 WSL 建立新的连接拓扑模型。

“明文”在本设计中定义为“字面 Shell 输入（literal shell input）”：用户命令的字符内容必须原样写入当前 Session 的 PTY。完成探针是工具基础设施产生的第二条独立 Shell 输入，不属于用户命令；目标机器的审计设施可能同时记录这条固定探针。若要求目标机器完全看不到任何辅助输入，则必须另行实现目标 Shell 的 prompt/OSC 集成，不属于本变更。

## Goals / Non-Goals

**Goals:**

- 让 `synapse_execute` 将用户命令以原始字面形式发送到当前共享 Session 的 PTY。
- 保留同一交互 Shell 中的 `cd`、`export`、PowerShell 变量和 SSH/容器嵌套语义。
- 用独立、固定、方言正确的完成探针读取退出码，并继续支持 `synapse_wait` 的事务收敛。
- 将 OSC 777 完成帧在 Main 侧从普通终端输出中分离，避免协议噪声进入 Renderer 和外部输出缓冲。
- 继续让策略、审批、命令哈希、执行标记和输出脱敏针对用户原始命令工作。
- 对可能伪造完成帧或破坏审计边界的输入在 PTY 写入前拒绝，并提供可识别错误。
- 通过 fake backend、Git Bash/PowerShell ConPTY 和 MCP 流程测试验证字面输入和完成协议。

**Non-Goals:**

- 不安装远程 helper，不改变目标机器的 Shell 配置，不建立远程审计日志或产品内审计数据库。
- 不保证操作系统进程审计一定还原用户的原始 Shell 文本；本变更保证 PTY 输入层的字面命令可被目标 Shell/SSH/跳板机录制。
- 不支持在完全没有辅助 Shell 输入的前提下，跨任意远程 Shell 可靠取得退出码；该能力需要独立的 Shell 集成变更。
- 不把用户命令转换成另一种 Shell 方言；Git Bash 中的 PowerShell cmdlet 仍然需要用户显式调用 `powershell.exe -Command`，或由现有风险策略拒绝。
- 不修改 Sharing、Token、端口、审批档位或 Session 持久化边界。

## Decisions

### D1. 采用“原始命令 + 独立完成探针”的两段式 PTY 输入

执行器为每次事务构造一个 dispatch payload：先放入用户原始命令，只补充 Shell 必需的提交行尾；随后放入一条由 Shell Driver 生成的固定完成探针。两段内容在同一个 PTY 写入操作中排队，避免本地键盘输入插入两者之间。

POSIX/Git Bash 的逻辑形态为：

```text
<用户原始命令><提交行尾>
printf '\033]777;TA;<nonce>;%s\007' "$?"<提交行尾>
```

PowerShell 使用等价的 `[Console]::Write(...)` 探针读取前一条命令的 `$?` 与 `$LASTEXITCODE`。探针不把用户命令作为字符串参数、变量值或脚本块重新解释，因此不会改变用户命令的审计文本或作用域。

选择该方案的原因是它保留当前本地 PTY 的传输无关语义，也适用于用户已经进入 SSH、跳板机、容器或 WSL 的场景。替代方案“只写原始命令再猜提示符”无法可靠区分命令输出和 prompt；“直接启动 `bash -c`/`powershell -Command`”会丢失当前 Session 状态并让审计看到新的包装进程；“安装 prompt hook”则要求目标 Shell 可修改，且无法覆盖所有嵌套环境。

### D2. 用 Shell Driver 生成方言探针，但禁止 Driver 包装用户命令

Terminal Service 新增或调整 Shell Driver 接口，使其负责：

- 根据 `terminalType` 选择 POSIX 或 PowerShell 方言；
- 校验用户输入是否包含 NUL、低位控制字符、OSC 777 或保留完成标记；
- 生成独立完成探针；
- 解析 `TA;<nonce>;<exitCode>` 完成帧。

Driver 不再提供把用户命令嵌入 `{ ... }`、`. { ... }`、`eval` 或编码载荷的能力。用户命令中合法出现的 `{}`、变量、管道和重定向必须原样保留；禁止的是实现额外添加的包装结构，而不是这些 Shell 语法本身。

### D3. 在 SessionActor 入口分离控制帧与可见输出

PTY 数据进入 `SessionActor` 后，以可跨回调边界的 carry 缓冲扫描 OSC 777 序列。普通输出继续发出 `pty_output`；完整的 `OSC 777;TA;...BEL` 发出独立 `osc_777` 事件，不再进入 Renderer 终端、输出缓冲或 MCP 的用户可见结果。未完整到达的序列留在 carry 中，下一次 PTY 回调继续解析。

当前分支只有 `pty_output` 事件，CommandExecutor 从普通输出中搜索完成帧；这会导致截图中的协议尾部泄露。事件拆分参考 `develop` 的 `SessionActor`，但只加入当前分支所需的控制帧能力，不迁移与本次需求无关的 Agent/Provider 模型。

### D4. 事务仍以原始命令为唯一用户动作

`CommandTransaction.command`、风险分类、审批卡片、会话内放行匹配、执行标记和命令哈希均使用外部调用传入的原始命令。完成探针不写入事务的 `command` 字段，也不参与审批或会话内放行匹配。

如果命令包含伪造完成帧的控制序列、保留协议标记或无法安全送入当前方言，执行器必须在 PTY 写入前返回 `COMMAND_NOT_AUDITABLE`（或在内部层映射为同一稳定错误前缀），不得退回旧包装器作为兼容路径。这样失败是显式的，而不是静默降低审计等级。

### D5. 原始命令与辅助探针使用同一次受控写入

`CommandExecutor` 使用一次 `SessionActor.writeUser()` 调用提交完整 dispatch payload；`SessionActor` 仍由 Main 持有 PTY，Renderer 不取得写入权限以外的内部状态。MCP 外部调用在现有 `ExternalToolPipeline` 中完成共享、租约、审批和脱敏，字面执行只替换最终 PTY payload 构造。

这样可以保留本地输入永不锁定的产品约束，同时避免将命令和探针拆成两个可被本地输入穿插的异步写入。如果用户命令本身进入 Shell continuation 或交互等待，探针会按 Shell 语义等待；事务仍可通过现有 `synapse_interrupt` 中断，不能把探针强行插入未完成的 Shell 语法中。

### D6. 以“PTY 输入可审计”而不是“字符串包含原文”验收

测试必须检查实际 backend write payload 的顺序和边界：用户命令从 payload 开始且只增加提交行尾，完成探针独立出现在其后；payload 不得出现 `eval`、Base64、用户命令变量赋值、自动添加的 brace group 或 dot-source。测试同时覆盖用户命令自身合法包含 `{}`、管道、重定向和 PowerShell 脚本的情况，避免用简单的 `not.toContain('{')` 误伤合法命令。

## Risks / Trade-offs

- [完成探针仍是目标 Shell 的一条辅助输入] → 在 Share Text、MCP 工具说明和设计文档中明确其边界；它是固定、可识别、可审计的工具命令。若未来要求零辅助输入，另建 Shell 集成 Change。
- [用户提交不完整的多行 Shell 语法时，探针可能进入 continuation] → 不重写或提前拼接用户语法；让 Shell 保持真实语义，使用现有等待/中断通道收敛。后续可按 Shell 方言增加完整性探测，但不在本变更中猜测语法。
- [用户命令输出或输入包含协议标记] → 在写入前拒绝 NUL、低位控制字符、OSC 777 和保留边界标记；完成帧只接受匹配当前 nonce 的结构化事件。
- [PowerShell `$?` 与 `$LASTEXITCODE` 语义不同] → 使用 PowerShell 专用探针同时读取两者，优先保留 native process exit code，并增加 cmdlet/native command 的 ConPTY 测试。
- [控制帧过滤改变当前普通输出事件的字节序列] → 仅过滤由工具协议生成的完整 OSC 777；普通 ANSI、Unicode 和不完整控制序列继续按现有有序输出机制传递，并覆盖跨 chunk 测试。
- [现有测试把 wrapper 当成正确行为] → 先新增失败的字面输入断言，再替换旧 wrapper 断言；不通过删除断言来掩盖行为变化。

## Migration Plan

1. 先补充 Shell Driver、CommandExecutor 和 SessionActor 的失败测试，锁定原始 PTY 输入、独立探针和控制帧隔离契约。
2. 实现 POSIX/Git Bash 与 PowerShell 的字面 payload 构造和方言完成帧解析。
3. 将现有 MCP 执行管线切换到新的 `CommandExecutor` dispatch；删除旧 `eval`/wrapper 路径，不保留静默 fallback。
4. 增加真实 Git Bash/PowerShell ConPTY 回归和 MCP 外部调用回归，确认共享、审批、退出码、状态保持、输出脱敏和中断没有回归。
5. 若验证失败，回滚只涉及本 Change 的执行协议模块；Session、MCP Token、端口和 Sharing 状态结构不需要迁移。

## Open Questions

无。本 Change 采用“原始命令 + 独立可审计完成探针”；“目标机器完全看不到任何辅助输入”的零探针方案明确留给后续 Shell 集成 Change。
