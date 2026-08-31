## ADDED Requirements

### Requirement: General Probe Echo Preference

系统 MUST 在“通用”设置中提供“隐藏完成探针回显”开关，默认值为开启（`true`），并明确说明该设置只控制本地终端 UI 的显示。

#### Scenario: Default preference

- **WHEN** 用户第一次启动应用或设置文件缺少该字段
- **THEN** 系统 MUST 使用 `hideCompletionProbeEcho: true`，终端 UI 默认不显示完成探针输入回显

#### Scenario: Diagnostic visibility

- **WHEN** 用户在“通用”设置中关闭“隐藏完成探针回显”
- **THEN** 本地终端 UI MUST 可以显示完成探针输入回显以便诊断，并 MUST 展示说明“探针仍会写入 PTY，远程服务器仍可能记录”

### Requirement: Persisted Restricted Settings API

GeneralSettings MUST 由 Electron Main 持久化和校验；Renderer MUST 只能通过受限 preload API 读取和更新 `hideCompletionProbeEcho`，不得直接访问 Node 文件 API、PTY 或 Session 内部状态。

#### Scenario: Preference survives restart

- **WHEN** 用户保存“隐藏完成探针回显”的新值并重启桌面端
- **THEN** Main MUST 从本机设置存储恢复该值，并将其应用到已有和新建 Session 的 UI 输出链路

#### Scenario: Invalid preference

- **WHEN** 设置文件损坏或 `hideCompletionProbeEcho` 不是布尔值
- **THEN** 系统 MUST 安全回退为 `true`，并继续提供 MCP 服务设置和终端 UI

### Requirement: UI-Only Probe Echo Filtering

探针可见性设置 MUST 只影响本地终端 UI 输出消费者。OSC 777 控制帧隔离、完成检测、退出码、CommandExecutor 输出缓冲、外部客户端输出脱敏和 PTY 实际写入 MUST 在开关两种状态下保持一致。

#### Scenario: Hidden UI echo

- **WHEN** 设置为隐藏且 PTY 返回完成探针输入回显和匹配 OSC 777 完成帧
- **THEN** UI MUST 只收到过滤后的终端输出，CommandExecutor MUST 收到正常业务输出并完成事务

#### Scenario: Visible UI echo does not leak to MCP

- **WHEN** 设置为显示且 PTY 返回完成探针输入回显和匹配 OSC 777 完成帧
- **THEN** UI MAY 收到探针输入回显，但 CommandExecutor 和外部客户端输出 MUST 继续过滤探针协议噪声且 MUST NOT 收到 OSC 777 控制帧

### Requirement: Explicit Safety Copy

设置界面 MUST 说明“隐藏”不是远程安全开关：关闭隐藏不改变探针是否写入当前 PTY，也不保证目标 Shell、SSH、终端或服务器审计设施看不到探针。

#### Scenario: User reads the setting explanation

- **WHEN** 用户打开“通用”设置
- **THEN** 页面 MUST 同时展示开关当前值和关于本地 UI、PTY 写入及远程审计可见性的安全说明
