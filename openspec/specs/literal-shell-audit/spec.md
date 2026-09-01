# literal-shell-audit Specification

## Purpose

TBD：归档后补充该能力的用途说明。

## Requirements

### Requirement: Literal User Command Dispatch

外部 `synapse_execute` 调用 MUST 将用户提交的命令文本以字面形式写入已共享 Session 的当前 PTY；除 Shell 必需的命令提交行尾外，系统 MUST NOT 改写、编码或重新解释用户命令。系统 MUST NOT 使用 `eval`、Base64、用户命令变量赋值、自动添加的 brace group、subshell、PowerShell dot-source、`bash -c` 或 `powershell -EncodedCommand` 包裹用户命令。

#### Scenario: Git Bash receives the original command

- **WHEN** 外部客户端在 Git Bash Session 中执行 `free -m`
- **THEN** 目标 PTY 输入 MUST 以 `free -m` 原文开始，且不得以 `__synapse_command`、`eval`、`{` 或其他工具包装器开始

#### Scenario: User syntax is preserved

- **WHEN** 外部客户端提交包含管道、重定向、变量或合法大括号的 POSIX/PowerShell 命令
- **THEN** 系统 MUST 保留这些用户字符的原始顺序和语义，且不得为了完成检测把它们重新放进字符串求值或脚本块

#### Scenario: Session state remains in the current Shell

- **WHEN** 外部客户端先执行会改变当前 Shell 状态的命令（例如 POSIX `cd` 或 PowerShell `Set-Location`），随后执行读取该状态的命令
- **THEN** 后续命令 MUST 在同一交互 Shell 中看到前一条命令产生的状态

### Requirement: Independent Auditable Completion Probe

每个字面外部执行 MUST 在用户原始命令之后提交一条由当前 Shell Driver 生成的独立完成探针。探针 MUST 读取原始命令的退出状态、发出带当前事务 nonce 的 OSC 777 完成帧，并且 MUST NOT 把用户命令作为变量值、脚本块或编码参数再次执行。目标机器的审计设施 MAY 记录该固定探针，但 MUST 能将其与用户原始命令区分。

#### Scenario: POSIX command reports its exit code

- **WHEN** POSIX/Git Bash Session 中的用户命令完成并返回退出码 7
- **THEN** 后续完成探针 MUST 发出匹配当前 nonce 且 exitCode 为 7 的完成帧，`synapse_wait` MUST 收敛为 `completed`

#### Scenario: PowerShell command reports its exit code

- **WHEN** PowerShell Session 中的 native command 或 PowerShell cmdlet 完成
- **THEN** PowerShell 探针 MUST 按对应 Shell 语义读取 `$?` / `$LASTEXITCODE` 并发出匹配 nonce 的完成帧，且不得使用 `-EncodedCommand`

#### Scenario: Long-running command keeps the transaction open

- **WHEN** 用户命令尚未完成且完成探针尚未被 Shell 执行
- **THEN** `synapse_execute` MAY 返回 `running`，`synapse_wait` MUST 持续等待或按超时返回当前快照，且系统不得提前伪造完成帧

### Requirement: Control Frame Isolation

Electron Main MUST 在 SessionActor 入口将完整的 OSC 777 控制帧与普通 PTY 输出分离。匹配完成帧 MUST 只作为结构化控制事件提供给 CommandExecutor；控制帧内容 MUST NOT 写入 Renderer 终端、普通输出缓冲或外部客户端可见的命令输出。跨多个 PTY 数据回调的半截控制帧 MUST 被保留并在后续数据到达时继续解析。

#### Scenario: Completion frame does not pollute the terminal

- **WHEN** PTY 输出用户文本后再输出 `OSC 777;TA;<nonce>;<exitCode>BEL`
- **THEN** Renderer 只能收到用户文本，CommandExecutor 只能收到独立完成事件，终端视图 MUST NOT 显示 `<7;TA` 或完成帧尾部

#### Scenario: Split control frame is reassembled

- **WHEN** OSC 777 完成帧的前半段和后半段分属两个 PTY 输出回调
- **THEN** Main MUST 在拼接后产生一个完整控制事件，且不得把半截控制序列作为普通终端文本显示

### Requirement: Audit Boundary Validation

字面执行分发 MUST 在写入 PTY 前拒绝包含 NUL、会伪造完成帧的 OSC 777、保留事务边界标记或当前 Shell Driver 无法安全提交的输入。拒绝 MUST 返回稳定的 `COMMAND_NOT_AUDITABLE` 错误前缀，并且 MUST NOT 退回旧包装器或产生任何 PTY 写入。

#### Scenario: Forged completion sequence is rejected

- **WHEN** 外部客户端提交包含 OSC 777 `TA` 完成序列的命令
- **THEN** 调用 MUST 以 `COMMAND_NOT_AUDITABLE` 开头失败，且目标 PTY MUST 没有收到该命令

#### Scenario: Invalid control character is rejected

- **WHEN** 外部客户端提交包含 NUL 或不允许的低位控制字符的命令
- **THEN** 调用 MUST 在策略/执行写入前被拒绝，且错误 MUST 指示该命令不可审计

### Requirement: Raw Command as the Policy and Visibility Subject

风险分类、审批卡片、会话内放行全文匹配、命令哈希、执行标记和 `CommandTransaction.command` MUST 使用用户原始命令；独立完成探针 MUST NOT 被当作用户命令展示、审批或写入事务命令字段。MCP 外部调用 MUST 继续遵循现有共享 Session、审批模式、租约和输出脱敏边界。

#### Scenario: Approval card shows the user command

- **WHEN** 原始命令需要 managed 模式人工裁决
- **THEN** 审批卡片 MUST 展示用户提交的命令全文，且 MUST NOT 展示内部完成探针作为待批准命令

#### Scenario: Execution marker identifies the user command

- **WHEN** 外部执行事务开始
- **THEN** 会话标签和面板条幅 MUST 展示原始命令和外部调用来源，事务完成探针不得替代或覆盖该命令

### Requirement: Shell-Specific Literal Protocol

Shell Driver MUST 根据当前 Session 的 Shell 类型生成语法正确的完成探针。Git Bash/POSIX MUST 使用 POSIX Shell 语法；PowerShell MUST 使用 PowerShell 语法；系统 MUST NOT 自动把一个 Shell 的 cmdlet 或语法转换成另一个 Shell 的用户命令。无法确认或不支持字面执行的 Session MUST 拒绝外部执行，而不是发送未知包装器。

#### Scenario: PowerShell cmdlet is not sent to Git Bash

- **WHEN** 外部客户端向 Git Bash Session 提交 `Get-CimInstance Win32_OperatingSystem`
- **THEN** 现有 Shell mismatch 策略 MUST 在 PTY 写入前返回拒绝，且不得把该 cmdlet 改写或包装成 Git Bash 输入

#### Scenario: POSIX and PowerShell probes use their own syntax

- **WHEN** 分别在 POSIX 和 PowerShell Session 中构造相同事务的完成探针
- **THEN** POSIX 探针 MUST 使用 POSIX `printf` 语法，PowerShell 探针 MUST 使用 `[Console]::Write` 或等价 PowerShell 语法，且两者都不得包含用户命令包装器
