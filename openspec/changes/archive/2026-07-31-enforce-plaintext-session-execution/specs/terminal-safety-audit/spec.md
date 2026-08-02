## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Structured Audit Events
系统 MUST 追加记录 Session、Agent Task、Tool Call、策略判断、授权、命令结果、中断、接管和错误等结构化审计事件，并为每个结构化 Shell 输入记录 transport、当前环境和 capability epoch 证据。

#### Scenario: Agent executes a command
- **WHEN** Command Transaction 从请求进入最终状态
- **THEN** 审计包含 actor、Session、Task、命令哈希、风险、Grant、时间、最终状态、transport mode、dialect/platform 和 capability epoch

#### Scenario: Environment verification fails
- **WHEN** 当前 PTY 指纹超时、歧义或明文 Probe 失败
- **THEN** 审计包含失败阶段、稳定错误码和被拒绝的 transport，且不记录 Protected Input 或伪造成功命令结果

### Requirement: Fail-Closed Authorization
策略解析、授权校验、敏感数据处理、environment verification、明文 dispatch 或执行入口审计发生内部错误时，系统 MUST 拒绝产生新的终端副作用，并不得回退到不可审计的编码执行。

#### Scenario: PolicyEngine throws an error
- **WHEN** ToolGateway 无法获得有效风险结果
- **THEN** 命令不执行、Task 进入错误或等待状态且审计记录失败原因

#### Scenario: Plaintext dispatch throws an error
- **WHEN** dispatch 无法证明当前 PTY source 可审计或 capability epoch 已过期
- **THEN** Core 不写入 Agent payload、不重试另一种隐藏 wrapper，并返回可恢复的 observation-only 错误
