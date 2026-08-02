# terminal-safety-audit Specification

## Purpose
规定 Agent 驱动终端操作的本地风险分类、精确审批、敏感输入与输出保护、结构化审计、数据留存、当前 Windows 用户隔离和 fail-closed 授权边界。
## Requirements
### Requirement: Deterministic Command Risk Classification
PolicyEngine MUST 使用结构化 POSIX Shell AST 和命令参数规则分类风险；语法错误、未知结构或无法证明只读的命令必须视为 `unknown` 或更高风险。

#### Scenario: Safe read-only command
- **WHEN** 命令 AST、命令名称和全部参数命中保守只读规则且没有危险重定向
- **THEN** PolicyEngine 分类为 `read_only`

#### Scenario: Find command deletes files
- **WHEN** 命令包含 `find -delete`、写重定向或其他修改语义
- **THEN** PolicyEngine 不得分类为 `read_only`

### Requirement: Unknown Commands Require Approval
只有确定性规则证明安全的只读命令 MAY 自动执行；`unknown`、mutating、privileged 和 destructive 命令 MUST 请求用户授权。

#### Scenario: Parser cannot classify a command
- **WHEN** AST 包含不支持节点、alias/function 覆盖或未知可执行程序
- **THEN** 系统显示完整命令并等待授权

### Requirement: Exact Command Approval
Approval Grant MUST 绑定一个 Session、顺序、完整命令文本和批准时的 environment capability epoch；任何编辑、插入、重排、目标改变或 environment epoch 改变都会使 Grant 失效。

#### Scenario: Approved command is edited
- **WHEN** Agent 或 UI 在授权后改变命令中的任何字符
- **THEN** Core 拒绝执行并要求新的 Approval Grant

#### Scenario: Execute exact approved list
- **WHEN** 待执行命令序列与有效 Grant 的命令、风险和 environment epoch 完全匹配
- **THEN** Core 可按批准顺序执行并记录 Grant ID

#### Scenario: Target environment changes after approval
- **WHEN** 用户在审批等待期间通过 SSH、容器或人工输入改变当前 PTY environment
- **THEN** Core 使旧 Grant 失效、取消旧审批卡片并要求重新 Probe；旧审批不能恢复模型或执行命令

### Requirement: Elevated Destructive Confirmation
privileged 命令 MUST 显示提权警告，destructive 命令 MUST 逐条执行二次确认且不得使用批量授权。

#### Scenario: Destructive command proposed
- **WHEN** PolicyEngine 识别到不可逆删除、磁盘写入、关机或同等级风险
- **THEN** UI 要求针对当前 Session 和该命令的二次确认

### Requirement: Policy Cannot Be Bypassed by Model Metadata
模型提供的风险标签、理由或 Tool 参数 MUST 仅作为说明，不能改变 PolicyEngine 结果或生成授权。

#### Scenario: Model labels mutation as read-only
- **WHEN** 模型将一个修改命令声明为 `read_only`
- **THEN** Core 忽略该声明并使用本地策略结果

### Requirement: Plaintext Execution Invariant
生产系统 MUST 保证所有 Core 生成并写入目标 PTY 的可执行 Shell source 是明文且可审计的；任何 Base64、hex、压缩或其他编码数据只有在不进入解码执行路径时才允许存在。禁止编码载荷流入 `eval`、`Invoke-Expression`、`ScriptBlock::Create`、dot-source 或等价动态代码执行。

#### Scenario: Server captures an Agent command
- **WHEN** 服务器或 Fake PTY 捕获 `terminal_execute` 的输入
- **THEN** 捕获内容包含可读原始命令、事务标记和 nonce，审计者无需解码另一段载荷即可判断将执行的命令

#### Scenario: Resource output uses data encoding
- **WHEN** 固定资源脚本为安全传输主机名或接口名而编码输出字段
- **THEN** 编码只用于结果序列化，任何解码结果都进入数据解析器而不是 Shell 执行器，并由测试证明该边界

#### Scenario: Encoded dynamic execution is introduced
- **WHEN** 代码把编码字符串解码后传给动态 Shell 执行 API
- **THEN** 静态门禁或运行时 dispatch 检查阻止发布/执行并记录违规原因

#### Scenario: Short transaction is captured by a server
- **WHEN** 服务器记录一条可安全内联的 Agent 单行命令
- **THEN** 同一条输入记录同时包含原始命令和可读事务边界，审计者无需拼接多条输入或解码载荷

### Requirement: Execution Sink Inventory
Core 和 Desktop MUST 维护可审计的生产执行入口清单，区分明文 Shell source、用户原始输入、显式 executable/argv 子进程和非执行数据编码；新增入口必须声明传输类别和审计行为。

#### Scenario: New PTY execution caller
- **WHEN** 新模块需要代表 Agent 向 PTY 写入 Shell source
- **THEN** 它只能通过统一 plaintext dispatch，并在清单和测试中声明 source kind、dialect、epoch 和失败行为

#### Scenario: Direct argv maintenance process
- **WHEN** Core 启动 `taskkill.exe`、`reg.exe` 或其他维护子进程
- **THEN** 调用使用显式 executable/argv、不经过 Shell 字符串解码，并按 `direct_argv` 记录或排除在 Shell source 审计之外

### Requirement: Server Audit Transport Attestation
每个 Agent 结构化执行尝试 MUST 产生可关联服务器会话审计的 transport attestation，至少包含 source kind、`plaintext | direct_argv | user_input | rejected` transport、已验证 dialect/platform、capability epoch、命令哈希、Lease/审批关联、时间和结果；长期审计不得保存 Protected Input 明文。

#### Scenario: Plaintext command succeeds
- **WHEN** 明文 Command Transaction 完成
- **THEN** 审计包含 `plaintext` transport、当前环境身份、命令哈希、审批/Lease 关联和最终退出状态

#### Scenario: Non-auditable command is rejected
- **WHEN** 环境未验证或 dispatch 发现编码动态执行路径
- **THEN** 审计记录 `rejected` transport 和稳定拒绝原因，且没有对应的成功副作用

### Requirement: Protected Input
密码和用户标记的 Protected Input MUST 不进入模型上下文、原始输入日志或审计 payload。

#### Scenario: User enters a sudo password
- **WHEN** Session 处于 Protected Input/User Takeover 状态
- **THEN** 按键仅发送到 PTY 且 Core 不持久化或转发该内容

### Requirement: Secret Redaction Before Disclosure
终端输出进入模型或长期审计前 MUST 经过可配置 secret detectors，用户本地终端显示不应被脱敏结果替换。

#### Scenario: Output contains an API token
- **WHEN** 输出匹配启用的 Token 或私钥检测规则
- **THEN** 模型上下文和审计 payload 使用脱敏值，而终端 UI 保留本地原始显示

### Requirement: Structured Audit Events
系统 MUST 追加记录 Session、Agent Task、Tool Call、策略判断、授权、命令结果、中断、接管和错误等结构化审计事件，并为每个结构化 Shell 输入记录 transport、当前环境和 capability epoch 证据。外部调用者执行时 MUST 以"外部调用者 + Session"作为审计主体，不伪造 Task/Turn。

#### Scenario: Agent executes a command
- **WHEN** Command Transaction 从请求进入最终状态
- **THEN** 审计包含 actor、Session、Task、命令哈希、风险、Grant、时间、最终状态、transport mode、dialect/platform 和 capability epoch

#### Scenario: Environment verification fails
- **WHEN** 当前 PTY 指纹超时、歧义或明文 Probe 失败
- **THEN** 审计包含失败阶段、稳定错误码和被拒绝的 transport，且不记录 Protected Input 或伪造成功命令结果

#### Scenario: External caller executes a command
- **WHEN** 外部调用者（MCP 客户端或 ACP 外部驱动者）的 Command Transaction 完成
- **THEN** 审计包含外部调用者来源、目标 Session、命令哈希、风险、审批结果与时间，且不包含伪造的 Task/Turn 归属

### Requirement: Layered Audit Retention
原始终端日志 MUST 短期且有界保留，结构化审计 SHALL 使用独立可配置的较长期限，完整终端录像不得默认无限保存。

#### Scenario: Cleanup runs
- **WHEN** 原始日志或审计事件超过各自保留期限
- **THEN** 清理任务按类别删除到期数据并记录清理摘要

### Requirement: Per-User Local Isolation
Core IPC、数据库、日志和 SecretStore MUST 限制在当前 Windows 用户安全边界内。

#### Scenario: Another OS user probes the pipe
- **WHEN** 不同 Windows 用户尝试连接当前用户的 Core Named Pipe
- **THEN** 操作系统 ACL 或握手认证拒绝连接

### Requirement: Renderer Cannot Access Secrets
Electron Renderer MUST 无法读取 Provider 密钥、SecretStore API、Core 数据库路径或原始 Credential Manager 内容。

#### Scenario: Compromised renderer invokes preload
- **WHEN** Renderer 调用未在窄 preload API 中声明的敏感操作
- **THEN** 请求不可达 Core 敏感接口并产生本地安全日志

### Requirement: Fail-Closed Authorization
策略解析、授权校验、敏感数据处理、environment verification、明文 dispatch 或执行入口审计发生内部错误时，系统 MUST 拒绝产生新的终端副作用，并不得回退到不可审计的编码执行。

#### Scenario: PolicyEngine throws an error
- **WHEN** ToolGateway 无法获得有效风险结果
- **THEN** 命令不执行、Task 进入错误或等待状态且审计记录失败原因

#### Scenario: Plaintext dispatch throws an error
- **WHEN** dispatch 无法证明当前 PTY source 可审计或 capability epoch 已过期
- **THEN** Core 不写入 Agent payload、不重试另一种隐藏 wrapper，并返回可恢复的 observation-only 错误

### Requirement: Stale Approval Is Not Actionable
Core 和 Desktop MUST 将 completed、cancelled、expired、environment-invalidated 或 task-cancelled 的 Approval 标记为不可操作；重复提交旧 approval id MUST 不产生终端副作用。

#### Scenario: User clicks an old approval
- **WHEN** 用户点击已经完成、取消或被新环境替代的旧审批卡片
- **THEN** Core 拒绝或幂等忽略该请求，不能恢复旧 Runtime、重复执行命令或创建新的审批循环

#### Scenario: Approval request is audited
- **WHEN** 审批因环境 epoch、任务状态或 approval id 失效而被拒绝
- **THEN** 审计记录稳定拒绝原因和关联的 task/tool/epoch，且不记录成功执行结果

### Requirement: Prototype Permission Menu
权限控件 MUST 复刻在线原型的人工审批、自动审批 (推荐) 和完全权限 (高风险) 选项及其琥珀、蓝、红状态。选择任一项 MUST 立即更新 Header 的原型可见标签，不显示额外确认步骤。

#### Scenario: Select automatic approval
- **WHEN** 用户从权限菜单选择“自动审批 (推荐)”
- **THEN** Header MUST 显示原型的蓝色自动审批状态，且菜单关闭

#### Scenario: Select full access
- **WHEN** 用户从权限菜单选择“完全权限 (高风险)”
- **THEN** Header MUST 显示原型的红色完全权限状态，且菜单关闭

### Requirement: Runtime Audit and Approval States
Timeline 审批和 Audit MUST 使用原型的色彩、间距和状态样式，且由真实 `agent.onTimeline` 和 `audit.list` 驱动。权限选择必须作为 `agent.start` 的 `permissionMode` 传入；批准、接管和取消必须调用对应 API。状态切换 MUST 不导致页面布局跳动。

#### Scenario: Preserve an approval result while changing tabs
- **WHEN** 用户批准或接管 Timeline 审批后切换到 Audit 再返回 Timeline
- **THEN** Timeline MUST 保留来自运行时事件的批准、拒绝或接管结果
