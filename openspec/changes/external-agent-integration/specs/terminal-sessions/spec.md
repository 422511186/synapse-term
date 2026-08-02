## MODIFIED Requirements

### Requirement: Exclusive Session Lease
任一时刻一个 Session MUST 只有一个输入控制者（用户、内置 Agent 或外部调用者），用户 SHALL 能随时撤销非用户 Lease。

#### Scenario: User emergency takeover
- **WHEN** 用户在 Agent 持有 Lease 时执行紧急接管
- **THEN** Lease epoch 增加、旧 Agent 写入令牌失效且后续输入归用户控制

#### Scenario: Stale Agent write
- **WHEN** Core 收到携带旧 Lease epoch 的 Agent 输入
- **THEN** 系统拒绝该输入并记录审计事件

#### Scenario: External caller conflicts with user input
- **WHEN** 用户正在输入而外部调用者请求执行
- **THEN** 外部调用者 MUST 等待或失败，且不得抢占用户输入

## ADDED Requirements

### Requirement: Shared Session
Terminal Session MUST 只有在用户显式复制其 sessionId 并披露给外部调用者后才可被外部调用寻址（Shared Session）；复制动作 MUST NOT 改变 Session 状态、Lease 或安全边界。

#### Scenario: User copies session id
- **WHEN** 用户从桌面 UI 复制某个 Ready Session 的 id
- **THEN** 该 Session 成为 Shared Session，外部调用者可携带该 id 寻址，其余 Session 保持不可寻址

#### Scenario: Session never shared
- **WHEN** 用户未复制任何 id
- **THEN** 所有外部寻址调用都失败，且错误不泄露会话存在性
