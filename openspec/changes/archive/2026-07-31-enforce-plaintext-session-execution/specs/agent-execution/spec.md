## ADDED Requirements

### Requirement: Plaintext Shell Transaction Transport
所有 Agent 生成的命令事务、Shell capability Probe 和固定资源脚本 MUST 以目标 Shell 可直接阅读的明文源写入 PTY；原始命令、事务边界、退出码和 nonce 完成标记 MUST 在服务器执行前可从 PTY 输入重组。系统 MUST NOT 把编码、压缩或其他不透明载荷解码后作为代码执行。

#### Scenario: POSIX command is dispatched
- **WHEN** Agent 请求执行一个有效 POSIX 命令
- **THEN** Fake PTY 和服务器输入审计都能看到该命令及明文事务边界，且写入内容不包含 Base64 解码后动态执行路径

#### Scenario: PowerShell command is dispatched
- **WHEN** Agent 请求执行 PowerShell 命令
- **THEN** PTY 输入包含可读的 PowerShell 当前作用域事务块，不包含 `FromBase64String`、`EncodedCommand` 或动态创建 ScriptBlock 的编码载荷

#### Scenario: Encoded execution path is detected
- **WHEN** dispatch 构造器或静态检查发现编码数据将流入动态 Shell 执行
- **THEN** Core 在写入 PTY 前返回 `command_not_auditable` 并不执行该命令

### Requirement: Cross-Dialect Environment Probe
结构化执行 MUST 先使用固定明文环境指纹确定当前 PTY 的 dialect，再只使用该 dialect 的明文 capability Probe；Core 不得为了猜测方言而依次注入多套 Shell 语法。

#### Scenario: Local hint disagrees with SSH target
- **WHEN** Session 启动 hint 为 PowerShell 但当前 PTY 已进入 POSIX 远端
- **THEN** Core 先完成有界指纹，选择 POSIX Probe 和 POSIX transaction driver，且不向远端写入 PowerShell wrapper

#### Scenario: Fingerprint times out
- **WHEN** 固定指纹或方言 Probe 在 deadline 内没有唯一成功完成事件
- **THEN** Agent Task 得到可恢复的环境未验证错误，Session 保持 observation-only，且不继续发送命令

### Requirement: Bounded Plaintext PTY Transport
明文 PTY writer MUST 以有界块传输原始源文本，不得在块边界插入编码字符或改变 Unicode；只有源代码中的行结束符可以映射为目标 PTY 的提交回车，并且不得因单行长度而截断或改写命令。

#### Scenario: Long Unicode command
- **WHEN** 命令包含超过单次 PTY 安全大小的单行或 Unicode 字符
- **THEN** Core 分成多个有界明文写入，重组后的源文本与 Tool 参数语义等价且不拆分字符

#### Scenario: Command contains multiple lines
- **WHEN** Agent 请求多行 POSIX 或 PowerShell 脚本
- **THEN** writer 保留行顺序和内容，事务块在目标 Shell 中一次完成解析，不把中间行提前作为独立命令提交

### Requirement: Auditable Single-Line Transaction Envelope
当原始命令是可安全内联的单行文本时，Core MUST 将明文事务边界、原始命令、退出码采集和完成标记作为一个物理 PTY 输入行提交；该行 MUST 直接包含原始命令，且不得包含编码后动态执行。Core MUST NOT 为了压成一行而改写包含物理换行、注释或续行语义的用户命令。

#### Scenario: Single-line POSIX command
- **WHEN** Agent 执行单行 POSIX 命令 `df -h`
- **THEN** Fake PTY 捕获一条包含 `df -h`、明文开始/完成边界和 nonce 的物理输入行

#### Scenario: Multi-line command remains structured
- **WHEN** Agent 请求带物理换行或行尾注释的 Shell 源文本
- **THEN** Core 保留原始行结构而不是以分号、`eval`、`sh -c` 或编码载荷重新解释文本

### Requirement: Bounded Fixed Resource Collection
Session Resource 刷新 MUST 使用一组固定、短小、只读的明文事务，而不是向交互 PTY 发送超过项目物理行安全上限的巨型资源脚本。每个事务 MUST 经过统一 dispatch，并在同一 Lease 和已验证 environment epoch 内顺序执行和合并输出。

#### Scenario: POSIX resource refresh
- **WHEN** 已验证的 POSIX Session 请求资源刷新
- **THEN** Core 发送多个受控长度的明文资源命令，所有捕获行均可审计，且不会发送单条超过安全上限的资源 payload

#### Scenario: Partial resource availability
- **WHEN** 某个固定资源命令在已验证环境中不可用或返回非零结果
- **THEN** Core 汇总其余命令的协议输出并返回 partial 或 unavailable 资源快照，不得回退到编码执行或超长脚本

### Requirement: Unified Agent PTY Dispatch
`terminal_execute`、Shell Probe、Session Resource 刷新和未来 Core 生成的 Shell 操作 MUST 经过同一个受控 dispatch；调用者 MUST 提供当前 Lease epoch、environment capability epoch、dialect 和 source kind，不能直接向 PTY 写入任意 Agent 字节。

#### Scenario: Resource refresh dispatch
- **WHEN** 用户请求刷新 Session 资源
- **THEN** 资源服务使用与 `terminal_execute` 相同的 environment、明文 transport、Lease 和审计校验，不绕过 Command/Probe dispatch

#### Scenario: Direct Agent PTY write attempt
- **WHEN** 新的 Core 模块尝试绕过 dispatch 调用低层 Agent PTY write API
- **THEN** 类型、模块边界或运行时 capability 校验拒绝调用，并产生安全审计

### Requirement: Non-Auditable Execution Rejection
无法识别当前 environment、无法构造语义等价的明文事务、Lease/epoch 失效或完成协议不可验证时，Agent MUST fail closed；系统不得回退旧编码 wrapper、猜测 Shell 或声明命令成功。

#### Scenario: Plaintext envelope cannot be built
- **WHEN** 命令包含无法安全传输的控制字符、边界冲突或不支持的 Shell 结构
- **THEN** Tool 返回 `command_not_auditable`，PTY 不接收该事务，Session 仍可被用户观察或接管

#### Scenario: Completion evidence is missing
- **WHEN** 明文事务已写入但没有匹配 nonce 的完成事件
- **THEN** Transaction 进入 `protocol_error`、`shell_lost` 或交互状态，不得返回 `completed`

## MODIFIED Requirements

### Requirement: Command Transaction Completion
`terminal.execute` MUST 为命令创建唯一 Command Transaction，并且只有匹配 nonce 的明文完成事件才能提供确定退出码；服务器可见的事务源文本必须与被批准的原始命令保持一致。

#### Scenario: Command completes normally
- **WHEN** Core 收到匹配 transaction nonce 的 OSC 完成事件
- **THEN** Transaction 标记 `completed` 并返回捕获的退出码

#### Scenario: Completion event is missing
- **WHEN** Shell 返回 prompt、退出或断连但没有匹配完成事件
- **THEN** Transaction 标记为交互、Shell 丢失或协议错误，且不得声明成功

#### Scenario: Wrapper changes the approved command
- **WHEN** dispatch 构造的 PTY source 与审批时的完整命令文本不一致
- **THEN** Core 在写入前使 Approval Grant 失效并拒绝执行

### Requirement: Persistent Shell State
命令协议 SHALL 在当前已验证 Shell 作用域中保持 `cd`、`export`、变量和受支持函数等状态变化，而不是默认在隔离子 Shell 或隐藏临时脚本中执行；明文事务外围不得覆盖用户命令的成功/失败语义而伪造完成。

#### Scenario: Change working directory
- **WHEN** Agent 执行已授权的 `cd` 命令并成功完成
- **THEN** 后续命令在新的工作目录中执行

#### Scenario: Preserve PowerShell state
- **WHEN** Agent 执行设置变量或 `Set-Location` 的 PowerShell 命令并成功完成
- **THEN** 后续 Transaction 在同一 PowerShell Session 观察到该状态且完成事件仍匹配 nonce

## REMOVED Requirements

### Requirement: POSIX Shell Probe
结构化执行前系统 MUST 探测当前 Shell 是否支持所需 POSIX 能力，并在人工输入或 User Takeover 后使旧 capability epoch 失效。

#### Scenario: Probe succeeds
- **WHEN** Shell 正确响应 `printf`、`eval` 和私有 OSC 探测
- **THEN** Session Shell 状态变为 `ready` 并允许受控命令执行

#### Scenario: Probe fails
- **WHEN** 当前 Shell 不支持协议或返回无法识别的响应
- **THEN** Agent 保持 observation-only 且不得执行结构化命令

**Reason**: 该需求把结构化执行错误地限定为 POSIX，并把 `eval` 作为能力要求；它无法覆盖 PowerShell 以及 SSH/容器跳转后的当前 PTY 环境。

**Migration**: 使用本变更的 `Cross-Dialect Environment Probe` 和 `Plaintext Shell Transaction Transport`，按当前 epoch 选择已验证的 POSIX 或 PowerShell driver。
