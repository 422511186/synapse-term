## MODIFIED Requirements

### Requirement: Bounded Ordered Terminal Output Frames

Electron Main MUST 在广播前隔离文件协议、载荷和内部快照，并将普通终端文本拆成不超过 IPC 预算的 UTF-8 完整分片。每个分片 MUST 使用严格递增 sequence，所有普通输出消费者 MUST 观察到相同字节顺序。协议失同步导致输出不可用时 MUST 显式暂停广播，不得将不明数据当作普通文本。

#### Scenario: PTY emits output larger than one IPC frame

- **WHEN** PTY 一次回调包含超过单帧预算的普通输出
- **THEN** Main MUST 生成多个有序有界帧，Renderer 按 sequence 连续写入，不丢弃普通文本

#### Scenario: Output contains multibyte UTF-8 characters

- **WHEN** 普通文本分片边界遇到多字节 UTF-8 字符
- **THEN** Main MUST 保持字符完整，拼接结果与隔离后的普通文本字节等价

#### Scenario: Protocol and text share a callback

- **WHEN** 文件协议与普通文本混合或跨回调到达
- **THEN** 系统 MUST 保持二者隔离及普通文本顺序，不广播文件载荷或内部快照

## ADDED Requirements

### Requirement: Session-Wide Operation Coordination

本地启用、检测、安装、传输、快照和所有外部写入 MUST 遵循同一 Session 顺序及互斥资格。活动本地操作 MUST 阻止外部 Probe、结构化执行、交互启动、事务输入、终结 Probe、中断和自由输入交错写入；活动外部事务或 Probe MUST 阻止本地操作启动。审批等待不得锁住本地功能。任何异步等待结束后 MUST 重新验证资格；输出可用时只读观察不受本地占用阻止。

#### Scenario: External writing overlaps a local operation

- **WHEN** 外部客户端在本地传输期间请求写类调用
- **THEN** 系统 MUST 在 Probe 或用户命令写入前以 `SESSION_BUSY` 拒绝，不中断本地操作

#### Scenario: Local action overlaps an external transaction

- **WHEN** 外部事务或 Probe 占用期间用户点击本地功能
- **THEN** 系统 MUST 返回忙碌，不排队猜测空闲后补发，直接本地输入保持可用

### Requirement: Local Operation Instance Binding

每次本地操作 MUST 绑定 Session、独立实例、操作类型和一次性响应标记；后续自动写入仅在实例有效时允许。用户输入、外部写入、操作终态、PTY 退出或协议失效 MUST 撤销该资格。旧握手、环境名称、能力代际或执行上下文 ID MUST NOT 单独作为新操作的目标证明。

#### Scenario: A stale response or selection arrives

- **WHEN** 新操作收到旧握手、旧完成帧或已过期的文件选择
- **THEN** 系统 MUST 不据此访问文件、写入 PTY 或发布新结果

### Requirement: Local Operations Invalidate External Preconditions

本地操作首次尝试写入 PTY 前 MUST 原子轮换 `executionContextId`、失效当前 PTY 环境验证并递增能力代际；操作终态 MUST 再次执行这些失效动作后释放资格。操作内正常协议帧不得逐块轮换上下文。写入异常、用户接管、取消未确认和协议丢失 MUST 不恢复旧值；本地快照或检测结果不得恢复 MCP 环境验证。未尝试写入的准备取消不改变执行前提。

#### Scenario: An external caller keeps a context from before transfer

- **WHEN** 外部客户端取得 C0 后，本地传输开始并正常结束且输出可用，客户端仍持 C0 执行
- **THEN** 系统 MUST 以 `EXECUTION_CONTEXT_STALE` 拒绝且不写入，要求重新观察

#### Scenario: Observation occurs during a local operation

- **WHEN** 客户端在本地操作期间取得 C1，操作随后成功、失败或进入未确认终态
- **THEN** C1 MUST 在终态后失效；新的外部执行仍须按当前环境验证规则处理

#### Scenario: Approval arrives after a completed local operation

- **WHEN** 外部审批等待期间本地操作开始并结束，旧审批随后允许
- **THEN** 系统 MUST 拒绝旧执行上下文，不得因本地占用已释放而写入旧命令

#### Scenario: Backend delivery is uncertain

- **WHEN** 本地启动写入尝试抛错且不能确认是否已经交付
- **THEN** 系统 MUST 撤销实例并报告未确认，保持环境与上下文失效，不自动重试

### Requirement: Local Takeover Stops Automatic Writes

本地输入 MUST 始终可提交。用户输入先进入 Session 顺序时，系统 MUST 停止后续协议发送并交付该输入，不缓存到 Shell 恢复后重放。取消只允许针对仍有效实例的有限取消或 PTY 中断；缺少远端结束证据 MUST 报告未确认，不声称远端进程已终止。

#### Scenario: User input precedes a protocol block

- **WHEN** 用户输入先于下一协议块进入处理顺序
- **THEN** 用户输入 MUST 保持可交付，后续协议块不得写入

#### Scenario: Completion precedes takeover

- **WHEN** 有效文件完成证据先被处理，之后用户输入
- **THEN** 已确认结果 MUST 保持，不被迟到取消改写

### Requirement: Bounded Protocol Failure Handling

协议处理 MUST 限制帧、解压、残留缓冲与终结等待预算。取消后只有在预算内取得匹配实例的完整终结证据、且能够证明帧边界和剩余数据归属时，才能恢复普通输出。无法证明边界或等待超限时 MUST 将该 Session 标为输出不可用，停止普通终端与 Sharing 输出及所有自动写入；不明数据只可有界丢弃，不保存、回放或按文本输出。

输出不可用 MUST 显示明确原因并保留本地输入和关闭能力。静默超时、提示符、迟到标记、窗口重开和重新 Sharing MUST NOT 恢复输出。此状态仅随 Session 关闭清除；用户可自行新建 Session，系统不得自动重连或重放认证。

#### Scenario: A protocol-like marker appears without an operation

- **WHEN** 普通程序输出类似协议标记，但没有匹配的主动操作
- **THEN** 系统 MUST 不获得本机文件权限或自动启动传输

#### Scenario: Late payload follows the cleanup deadline

- **WHEN** 半帧取消后未在预算内确认边界，迟到载荷与普通文本随后到达
- **THEN** 系统 MUST 保持输出不可用并有界丢弃数据，不向 UI 或 Sharing 泄露载荷，也不静默宣称恢复

#### Scenario: Output becomes unavailable while the PTY is running

- **WHEN** 协议失同步但本地 PTY 仍运行
- **THEN** 系统 MUST 保留本地输入与关闭入口，显示需要新建 Session 的说明，禁止自动复用该输出通道

### Requirement: Local Operation Lifecycle Follows the Session

本地操作、引用与快照 MUST 由 Main 持有且仅在应用运行期有效。窗口分离不终止已启动操作；重开 MUST 读取当前有界状态并订阅实时事件，不回放终端历史或重启操作。Session 关闭、应用退出和已确认更新的 Session 清理 MUST 撤销资格并释放流及 PTY，用户保存文件保持。

#### Scenario: Window reopens during a transfer

- **WHEN** 窗口关闭后传输继续，用户重开窗口
- **THEN** 界面 MUST 显示当前状态，不重传、不恢复已过期引用

#### Scenario: Session closes with pending callbacks

- **WHEN** Session 清理后收到文件选择、进度或完成回调
- **THEN** 回调 MUST 不再获得文件或终端访问权，不影响已保存结果
