## ADDED Requirements

### Requirement: Completion Evidence Loss Is Not Command Failure

当用户命令可能已经写入 PTY 但系统未取得匹配完成证据时，外部事务 MUST 区分“结果已确认”和“结果不可确认”。连接或 PTY 断开、用户输入干扰或完成 Probe 丢失时 MUST 进入 `unknown`，不得自动重新提交。

#### Scenario: PTY disconnects before the completion frame

- **WHEN** 用户原始 command 已写入 PTY，但连接在匹配 nonce 的完成帧到达前断开
- **THEN** 事务 MUST 返回 `unknown`，并 MUST 明确系统无法确认远端是否执行，不得自动重试

#### Scenario: User interferes before completion evidence

- **WHEN** 用户在完成帧到达前向同一 PTY 输入内容
- **THEN** 本地输入 MUST 保持可用，原外部事务 MUST 进入 `unknown`，不得把后续输入归入原事务

## MODIFIED Requirements

### Requirement: Independent Auditable Completion Probe

每个字面外部执行 MUST 在用户原始 command 之后提交一条由当前 Shell Driver 生成的独立完成 Probe。Probe MUST 读取原始 command 的退出状态、发出带当前事务 nonce 的 OSC 777 完成帧，并且 MUST NOT 把用户 command 作为变量值、脚本块或编码参数再次执行。目标机器的审计设施 MAY 记录该固定 Probe，但 MUST 能将其与用户原始 command 区分。收到匹配完成帧后，系统 MUST 在有上限的短 drain window 内接收同一 Session 已到达的普通 PTY 输出；未收到可靠完成帧时，事务 MUST 进入 `unknown` 或对应的写入前错误，不得伪造 `completed`。

#### Scenario: POSIX command reports its exit code

- **WHEN** POSIX/Git Bash Session 中的用户 command 完成并返回退出码 7
- **THEN** 后续完成 Probe MUST 发出匹配当前 nonce 且 exitCode 为 7 的完成帧，`synapse_wait` MUST 收敛为 `completed`，即使命令退出码非零

#### Scenario: PowerShell command reports its exit code

- **WHEN** PowerShell Session 中的 native command 或 PowerShell cmdlet 完成
- **THEN** PowerShell Probe MUST 按对应 Shell 语义读取 `$?` / `$LASTEXITCODE` 并发出匹配 nonce 的完成帧，且不得使用 `-EncodedCommand`

#### Scenario: Long-running command keeps the transaction open

- **WHEN** 用户 command 尚未完成且完成 Probe 尚未被 Shell 执行
- **THEN** `synapse_execute` MAY 返回 `running`，`synapse_wait` MUST 持续等待或按本次调用超时返回当前快照，且系统不得提前伪造完成帧

#### Scenario: Drain window preserves late output

- **WHEN** 完成帧先于相邻 PTY 数据中的普通 stdout 到达，且 stdout 在有上限的 drain window 内到达
- **THEN** 外部事务结果 MUST 包含该普通 stdout 并保持顺序，Probe 和 OSC 777 不得进入用户输出

### Requirement: Audit Boundary Validation

字面执行分发 MUST 在写入 PTY 前拒绝包含 NUL、会伪造完成帧的 OSC 777、保留事务边界标记、明确交互式行为或当前 Shell Driver 无法安全提交的输入。违反字面审计边界 MUST 返回稳定的 `COMMAND_NOT_AUDITABLE` 错误；已知交互式 command MUST 返回 `INTERACTIVE_COMMAND_UNSUPPORTED`；两者均 MUST NOT 退回旧包装器或产生任何用户 command 的 PTY 写入。

#### Scenario: Forged completion sequence is rejected

- **WHEN** 外部客户端提交包含 OSC 777 `TA` 完成序列的 command
- **THEN** 调用 MUST 以 `COMMAND_NOT_AUDITABLE` 开头失败，且目标 PTY MUST 没有收到该 command

#### Scenario: Invalid control character is rejected

- **WHEN** 外部客户端提交包含 NUL 或不允许的低位控制字符的 command
- **THEN** 调用 MUST 在策略/执行写入前被拒绝，且错误 MUST 指示该 command 不可审计

#### Scenario: Known interactive command is rejected

- **WHEN** 外部客户端提交没有返回当前 Shell 提示符的交互式 `ssh`、`docker exec -it` 或终端程序 command
- **THEN** 调用 MUST 以 `INTERACTIVE_COMMAND_UNSUPPORTED` 开头失败，且用户 command 和完成 Probe 均不得写入 PTY

#### Scenario: Unknown script remains literal

- **WHEN** 外部客户端提交无法静态判断是否读取标准输入的自定义脚本 command
- **THEN** 系统 MUST 保留 command 原文执行能力，不得因为无法判断就自动包装或翻译；若完成证据未到达，事务按 `unknown` 处理
