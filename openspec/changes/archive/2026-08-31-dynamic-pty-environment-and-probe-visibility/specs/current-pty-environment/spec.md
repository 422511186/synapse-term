## ADDED Requirements

### Requirement: Current PTY Environment Identity

每个可执行 Session MUST 保存当前 PTY environment capability，至少包含 `posix | powershell | unknown` dialect、`windows | unix | unknown` platform、验证状态、验证来源、验证时间和 capability epoch。Session 启动时的 `terminalType` 只能作为 hint，不能单独授权结构化外部调用。

#### Scenario: PowerShell enters a POSIX remote Session

- **WHEN** 用户从 PowerShell Session 中进入 Linux/Unix SSH、跳板机、容器或 WSL 环境后发起外部结构化调用
- **THEN** 系统 MUST 通过当前 PTY 的固定 Probe 将 environment 验证为 `posix`，使用 POSIX Shell Driver，并且不创建 SSH/服务器拓扑对象

#### Scenario: POSIX enters a PowerShell Session

- **WHEN** 用户从 POSIX Session 中进入 PowerShell 后发起外部结构化调用
- **THEN** 系统 MUST 只在当前 environment epoch 验证到 `powershell` 后使用 PowerShell Shell Driver，不得信任原始 POSIX hint

### Requirement: Verified Environment Before Structured External Call

外部结构化命令 MUST 在写入用户命令前拥有当前 Session 的 verified environment。environment 未验证、Probe 未完成、Probe 超时或结果歧义时，系统 MUST 保持 observation-only 并在 PTY 写入用户命令前拒绝调用。

#### Scenario: First external command

- **WHEN** Session 刚启动且外部客户端首次调用 `synapse_execute`
- **THEN** 系统 MUST 先运行固定、有限、带 nonce 的明文 environment Probe，再根据 Probe 结果选择 Driver 并发送用户命令原文

#### Scenario: Probe timeout

- **WHEN** 当前 PTY 在共享 deadline 内没有返回唯一可解析的方言和平台指纹
- **THEN** 系统 MUST 返回 observation-only/环境未验证错误，且 MUST NOT 发送该次用户命令

### Requirement: Current Environment Epoch Invalidation

用户输入、Shell 接管和 PTY 退出等会改变当前 PTY 语义的事件 MUST 使 environment capability epoch 失效并清除 verified 状态；带旧 environment epoch 的外部写入 MUST 在 PTY 写入前拒绝。

#### Scenario: User enters an SSH hop

- **WHEN** 外部调用完成后用户在同一 Session 中输入 SSH、容器或嵌套 Shell 命令
- **THEN** 系统 MUST 递增 capability epoch、清除当前 verified environment，并要求下一次外部结构化调用重新 Probe

#### Scenario: Stale external epoch

- **WHEN** 外部调用带着已经失效的 environment epoch 请求写入
- **THEN** 系统 MUST 在 PTY 写入前拒绝该调用并保持用户命令未写入

### Requirement: External Write Is Separate From User Input

经过 caller 租约和当前 environment epoch 校验的外部 Probe/命令写入 MUST 通过独立的外部写入入口；该入口不得把自身写入标记为用户接管或递增 environment epoch。用户输入入口 MUST 继续使外部 capability 失效。

#### Scenario: Valid external write

- **WHEN** 外部调用持有当前 caller 租约且 environment epoch、dialect、platform 均匹配
- **THEN** 系统 MUST 原文写入命令和完成探针，并保持本次 environment capability 有效

#### Scenario: User input during a pending Probe

- **WHEN** Probe 等待期间用户输入任意字节
- **THEN** 系统 MUST 使 Probe 结果失效，外部调用 MUST NOT 继续发送用户命令

### Requirement: Literal Cross-Environment Dispatch

选定 Driver 后，系统 MUST 保持用户命令的字节序列和可审计原文边界；不得使用 Base64、`eval`、命令 wrapper 或隐式翻译来跨环境执行。固定 Probe 可以写入其自身所需的明文诊断命令，但不能包裹用户命令。

#### Scenario: Command audit trail

- **WHEN** verified POSIX 或 PowerShell environment 接收到外部用户命令
- **THEN** PTY 写入 MUST 以用户命令原文开始并随后写入独立完成探针，事务中记录的 command MUST 与请求全文一致

#### Scenario: Unknown environment

- **WHEN** environment dialect 为 `unknown` 或 verification status 不是 `verified`
- **THEN** 系统 MUST 不选择启动 hint 对应的 Driver，也 MUST NOT 写入外部用户命令
