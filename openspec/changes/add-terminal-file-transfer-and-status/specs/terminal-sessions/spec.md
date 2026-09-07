## MODIFIED Requirements

### Requirement: Bounded Ordered Terminal Output Frames

Electron Main MUST 在向 Renderer 广播前先隔离属于当前操作的控制协议、文件载荷和内部结构化快照，再将任意大小的普通终端输出拆成不超过 IPC 输出预算的 UTF-8 完整分片；每个分片 MUST 使用新的严格递增 sequence，且所有普通输出消费者 MUST 观察到相同字节顺序。普通输出分片的字节等价要求 MUST 适用于完成协议隔离后的文本，不能要求将文件数据重新广播到终端。

#### Scenario: PTY emits output larger than one IPC frame

- **WHEN** 一个 Terminal Session 的 PTY 一次回调返回超过 IPC 单帧上限的普通输出
- **THEN** Main MUST 生成多个有序输出事件并广播多个有界输出帧，Renderer MUST 按 sequence 连续写入终端且不丢弃普通文本分片

#### Scenario: Output contains multibyte UTF-8 characters

- **WHEN** Main 在普通文本分片边界遇到多字节 UTF-8 字符
- **THEN** Main MUST NOT 拆开该字符或产生替换字符，拼接所有普通文本分片后 MUST 与协议隔离后的原始普通文本字节等价

#### Scenario: File data and ordinary output share one callback

- **WHEN** 一次 PTY 数据回调同时包含当前操作文件协议和普通文本
- **THEN** Main MUST 将协议交给绑定操作，普通文本保持顺序广播，文件载荷不得进入 Renderer 终端或 Sharing 历史

## ADDED Requirements

### Requirement: Session-Wide Operation Coordination

本地启用、文件操作、快照采集与外部写入 MUST 通过同一 Session 的有序协调检查写入资格。活动本地操作 MUST 阻止外部 Probe、结构化执行、交互启动、事务输入及自由输入交错进入 PTY；活动外部事务或外部 Probe MUST 阻止新的本地功能启动。等待文件选择、人工审批或其他异步阶段后 MUST 重新校验上下文与资格。只读观察 MUST 不因本地操作占用而被禁止。

#### Scenario: External execution arrives during a local transfer

- **WHEN** 已 Sharing Session 正在进行本地文件传输，外部客户端发起写类调用
- **THEN** 调用 MUST 在任何 Probe/命令写入前以 Session 忙碌语义拒绝，不能通过不同入口绕过占用

#### Scenario: Local action arrives during an external transaction

- **WHEN** 外部事务或 Probe 已持有写入资格，用户请求上传、下载或快照
- **THEN** 本地功能 MUST 返回忙碌并保持原操作，不自动 Ctrl+C，不影响直接本地输入能力

#### Scenario: Local input changes a pending approval context

- **WHEN** 外部审批等待期间用户输入或开始本地操作，随后旧审批返回允许
- **THEN** 外部写入 MUST 重新校验上下文和占用，旧批准不得跨越前提变化继续发送命令

### Requirement: Local Operation Instance Binding

每次本地操作 MUST 绑定当前 Session、操作实例、预期操作类型和本次响应标记；持续协议输入只在该实例有效期间允许。启动提示、主机名称、能力代际与执行上下文 ID MUST NOT 单独替代本次响应验证。用户输入、外部写入、操作终态、PTY 退出或协议失效 MUST 撤销后续自动写入资格；旧响应不得绑定新操作。

#### Scenario: Old handshake is replayed

- **WHEN** 新操作收到上一操作的握手或完成帧
- **THEN** 系统 MUST 不接受该帧作为新操作的控制或完成证据，不能据此开始发送文件或发布快照

#### Scenario: Only the local PTY remains running

- **WHEN** 远端接收器已退出或 SSH 跳转已结束，但本地 PTY 仍为 running
- **THEN** 系统 MUST 不以 running 状态继续授权原操作，未取得终态证据时报告未确认结果

### Requirement: Local Takeover Stops Automatic Protocol Writes

本地用户输入 MUST 始终可用，不能被外部租约或本地功能永久锁定。操作期间发生用户输入或中断时，系统 MUST 在相同 Session 顺序中停止新增协议写入、撤销操作资格，并按本地输入语义交付输入；MUST NOT 保存按键并在稍后 Shell 恢复时自动重放。中断只能承诺本地 PTY 输入及已取得的协议结果，不能声称远端进程必然结束。

#### Scenario: User input wins a queued protocol write

- **WHEN** 用户输入先于下一块文件数据进入 Session 队列
- **THEN** 用户输入 MUST 保持可交付，随后文件数据不得继续写入；缺少完成/取消证据时显示未确认结果

#### Scenario: Transfer completion precedes takeover

- **WHEN** 完整有效的文件完成证据已被处理，之后用户开始输入
- **THEN** 已确认文件结果 MUST 保留成功，用户输入不得被旧操作捕获或触发旧操作重启

### Requirement: Local Protocol Isolation Is Bounded

文件协议和内部快照 MUST 在普通文本清理、脱敏与分页之前分流，处理跨回调分片并限制协议帧、缓冲和解压输出。仅有与主动准备操作匹配的协议才能消费本机文件引用。取消、格式错误和迟到数据 MUST 不将已识别载荷回灌普通文本；残留协议处理 MUST 有界，不能无界吞掉之后的正常终端内容。

#### Scenario: Terminal text imitates a file protocol

- **WHEN** 普通程序输出类似传输标记，而用户没有准备对应操作
- **THEN** 系统 MUST 不因此读取/写入本机文件或获得文件选择权限

#### Scenario: A payload is split at every possible boundary

- **WHEN** 协议标记、载荷和结束帧跨多个 PTY 回调到达
- **THEN** 系统 MUST 保持协议隔离与顺序，不泄露半截文件数据，不通过无界缓冲等待结束

### Requirement: Local Operation Lifecycle Follows the Session

本地操作、文件引用和快照 MUST 由 Main 持有且仅在应用运行期有效。窗口分离 MUST 不终止已启动操作，重连只读取当前状态并订阅实时事件；Session 关闭、应用退出及已确认更新的 Session 清理 MUST 撤销资格、释放本机流并清理 PTY。用户保存的传输结果 MUST 保留，不恢复任何操作、授权或快照。

#### Scenario: Window reopens during a transfer

- **WHEN** 窗口关闭后 Main 中的传输仍在运行，用户重开窗口
- **THEN** UI MUST 显示 Main 当前状态并继续订阅进度，不重启传输、不回放终端历史

#### Scenario: Session closes while a file operation is pending

- **WHEN** 用户关闭 Session、退出应用或确认更新后 Session 被清理
- **THEN** 系统 MUST 撤销操作和文件引用，关闭本机流；迟到回调不得再次写入，已保存用户文件保留
