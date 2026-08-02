## ADDED Requirements

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
Approval Grant MUST 绑定一个 Session、顺序和完整命令文本；任何编辑、插入、重排或目标改变都会使 Grant 失效。

#### Scenario: Approved command is edited
- **WHEN** Agent 或 UI 在授权后改变命令中的任何字符
- **THEN** Core 拒绝执行并要求新的 Approval Grant

#### Scenario: Execute exact approved list
- **WHEN** 待执行命令序列与有效 Grant 完全匹配
- **THEN** Core 可按批准顺序执行并记录 Grant ID

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
系统 MUST 追加记录 Session、Agent Task、Tool Call、策略判断、授权、命令结果、中断、接管和错误等结构化审计事件。

#### Scenario: Agent executes a command
- **WHEN** Command Transaction 从请求进入最终状态
- **THEN** 审计包含 actor、Session、Task、命令哈希、风险、Grant、时间和最终状态

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
策略解析、授权校验或敏感数据处理发生内部错误时，系统 MUST 拒绝产生新的终端副作用。

#### Scenario: PolicyEngine throws an error
- **WHEN** ToolGateway 无法获得有效风险结果
- **THEN** 命令不执行、Task 进入错误或等待状态且审计记录失败原因
