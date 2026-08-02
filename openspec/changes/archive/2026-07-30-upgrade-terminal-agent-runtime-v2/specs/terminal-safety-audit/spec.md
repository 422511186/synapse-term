## ADDED Requirements

### Requirement: Local File Risk Classification
LocalFilePolicy MUST 根据操作、相对路径、文件类型和内容特征分类普通、敏感或高影响本机文件操作；模型声明不得降低风险。

#### Scenario: Read an SSH private key
- **WHEN** Agent 请求读取当前用户 `.ssh` 下的私钥
- **THEN** 系统要求本地审批且在发送模型前执行秘密脱敏

#### Scenario: Edit an ordinary source file
- **WHEN** Agent 修改不命中敏感规则的普通文本文件且用户采用自动普通写入策略
- **THEN** 系统可自动执行并记录前后哈希

### Requirement: Local File Approval Integrity
本机文件 Approval Grant MUST 绑定 Conversation、Turn、Tool Call、相对路径、操作、预期文件哈希和完整变更；任一字段变化都会使授权失效。

#### Scenario: Patch changes after approval
- **WHEN** 模型在用户批准后修改 Patch 或目标路径
- **THEN** Core 拒绝执行并要求新的审批

### Requirement: Local File Audit Events
系统 MUST 为本机文件 list、search、read、create、replace 和 edit 追加结构化审计，记录相对路径、风险、审批、前后 SHA-256、字节数、时间和结果，不默认保存完整文件内容。

#### Scenario: Agent replaces a local file
- **WHEN** `local_write_file` 成功替换文件
- **THEN** 审计包含旧哈希、新哈希、相对路径、actor 和 Tool Call ID

### Requirement: Conversation Permission Modes
Core MUST 支持 `manual`、`auto` 和 `full_access` Permission Mode，并 SHALL 在策略执行前根据模式与风险决定是否暂停审批。Terminal 命令风险 MUST 按 Tool Call 执行时 Session 的当前 execution dialect 分类；无法可靠解析的命令 MUST fail closed 为 `unknown`。

#### Scenario: Manual mode PowerShell read-only command
- **WHEN** `manual` Conversation 在 PowerShell Session 中执行可确认只读的 `Get-*` Cmdlet 或等价只读命令
- **THEN** Core 将风险记录为 `read_only`，在写入 PTY 前仍暂停并要求绑定精确 Tool Call 的批准

#### Scenario: Manual mode POSIX read-only command
- **WHEN** `manual` Conversation 执行内存、CPU、磁盘、网络或其他可确认只读的 POSIX 命令
- **THEN** Core 在写入 PTY 前暂停并要求批准，批准或拒绝后使用同一时间线 ID 发布不可再次操作的终态

#### Scenario: Manual mode ordinary mutation
- **WHEN** `manual` Conversation 请求普通文件编辑或 mutating Terminal 命令
- **THEN** 操作暂停并要求绑定精确 Tool Call 的批准

#### Scenario: Auto mode ordinary mutation
- **WHEN** `auto` Conversation 请求普通 mutating 操作且未命中敏感、unknown、privileged 或 destructive 规则
- **THEN** Core 自动执行并记录模式、风险和结果，不弹出批准

#### Scenario: Auto mode PowerShell privileged or destructive command
- **WHEN** `auto` Conversation 在 PowerShell Session 中请求服务控制、提权、递归删除或其他 privileged/destructive 命令
- **THEN** Core 在写入 PTY 前暂停审批，时间线和审计记录正确的风险而不是笼统的 `unknown`

#### Scenario: Full access destructive operation
- **WHEN** 用户明确选择 `full_access` 后模型请求已通过所有边界校验的 destructive Tool Call
- **THEN** Core 不弹出审批但仍记录高风险、完整参数、模式和结果

#### Scenario: Full access PowerShell destructive command
- **WHEN** `full_access` Conversation 在 PowerShell Session 中执行已通过边界校验的 `Remove-Item -Recurse` 等破坏性命令
- **THEN** Core 不弹出审批、实际执行该命令，并在审计中记录 `destructive` 与 `full_access`

### Requirement: Non-Bypassable Boundaries
任何 Permission Mode MUST 保留 Tool allowlist、Session 绑定、本机 home canonical path、SecretRedactor、expected hash、Lease epoch 和参数 Schema 边界。

#### Scenario: Full access attempts local path escape
- **WHEN** `full_access` Agent 调用本机文件 Tool 使用绝对路径或 `..` 逃逸
- **THEN** Core fail closed，文件不读取或修改且审计记录拒绝

### Requirement: Permission Mode Audit
Permission Mode 的选择、变更和每次用于策略判断的结果 MUST 进入结构化审计，活动审批不得因模式改变而自动获得授权。

#### Scenario: Change mode while approval is pending
- **WHEN** 一个 Tool Call 正在等待批准且用户把模式改为 `full_access`
- **THEN** 原审批仍需显式处理或取消，新模式只影响后续 Tool Call

## MODIFIED Requirements

### Requirement: Secret Redaction Before Disclosure
终端输出或本机文件内容进入模型或长期审计前 MUST 经过可配置 secret detectors，用户本地终端和经授权的本地文件 Diff 不应被模型披露版本替换。

#### Scenario: Local file contains an API token
- **WHEN** `local_read_file` 读取内容匹配 Token 检测规则
- **THEN** 模型 Tool Result 使用脱敏值，审计不保存明文 Token

### Requirement: Structured Audit Events
系统 MUST 追加记录 Session、Conversation、Turn、Tool Call、策略判断、授权、命令结果、文件操作、中断、接管和错误等结构化审计事件。

#### Scenario: Agent executes a file and terminal workflow
- **WHEN** 一个 Turn 修改本机脚本后在终端执行命令
- **THEN** 审计可按 Conversation/Turn 关联文件 Tool、Terminal Tool、审批和最终状态

### Requirement: Fail-Closed Authorization
终端或本机文件策略解析、路径边界、授权校验、哈希冲突或敏感数据处理发生内部错误时，系统 MUST 拒绝产生新的副作用。

#### Scenario: File canonicalization fails
- **WHEN** Core 无法证明目标文件 canonical path 位于当前用户 home 内
- **THEN** 文件不读取或写入、Turn 获得明确错误且审计记录拒绝原因
