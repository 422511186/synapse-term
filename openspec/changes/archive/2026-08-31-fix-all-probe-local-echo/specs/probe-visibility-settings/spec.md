## MODIFIED Requirements

### Requirement: General Probe Echo Preference

系统 MUST 在“通用”设置中提供“隐藏自动 Probe 回显”开关，默认值为开启（`true`），并明确说明该设置只控制本地终端 UI 的显示。开启时，终端 UI MUST 隐藏 Synapse Term 自动注入的环境识别 Probe 和命令完成 Probe 的本地回显；关闭时，终端 UI MAY 显示这些自动 Probe 的回显以便诊断。

#### Scenario: Default preference

- **WHEN** 用户首次启动桌面端并创建 Session
- **THEN** 系统 MUST 使用 `hideCompletionProbeEcho: true`，终端 UI 默认不显示环境识别 Probe 或命令完成 Probe 的本地回显

#### Scenario: Diagnostic visibility

- **WHEN** 用户在“通用”设置中关闭“隐藏自动 Probe 回显”
- **THEN** 本地终端 UI MAY 显示环境识别 Probe 和命令完成 Probe 的回显以便诊断，并 MUST 展示说明“Probe 仍会写入 PTY，远程服务器仍可能记录”

### Requirement: Persisted Restricted Settings API

GeneralSettings MUST 由 Electron Main 持久化和校验；Renderer MUST 只能通过受限 preload API 读取和更新 `hideCompletionProbeEcho`，不得直接访问 Node 文件 API、PTY 或 Session 内部状态。

#### Scenario: Preference survives restart

- **WHEN** 用户保存“隐藏自动 Probe 回显”的新值并重启桌面端
- **THEN** Main MUST 加载并应用该值到已有和新建 Session 的本地终端 UI 输出

#### Scenario: Invalid preference

- **WHEN** 设置文件损坏或 `hideCompletionProbeEcho` 不是布尔值
- **THEN** 系统 MUST 回退为隐藏所有自动 Probe 回显，并 MUST NOT 因设置内容向 PTY 写入额外命令

### Requirement: UI-Only Probe Echo Filtering

探针可见性设置 MUST 只影响本地终端 UI 输出消费者。环境验证、OSC 777 控制帧隔离、完成检测、退出码、CommandExecutor 输出缓冲、外部客户端输出脱敏和 PTY 实际写入 MUST 在开关两种状态下保持一致。Probe MUST 继续以固定明文写入当前 PTY，并可能被目标 Shell、SSH、终端或服务器审计设施记录。

#### Scenario: Hidden UI echo

- **WHEN** 设置为隐藏且 PTY 返回环境识别 Probe 命令/结果或命令完成 Probe 输入回显和匹配 OSC 777 完成帧
- **THEN** 本地终端 UI MUST 隐藏自动 Probe 回显，ShellProbe/CommandExecutor MUST 仍能完成验证和事务收敛，且 PTY 写入内容 MUST 保持不变

#### Scenario: Visible UI echo does not leak to MCP

- **WHEN** 设置为显示且 PTY 返回环境识别 Probe 或命令完成 Probe
- **THEN** UI MAY 收到自动 Probe 回显，但 CommandExecutor 和外部客户端输出 MUST 继续过滤 Probe 协议噪声且 MUST NOT 收到 OSC 777 控制帧

### Requirement: Explicit Safety Copy

设置界面 MUST 说明“隐藏”不是远程安全开关：关闭隐藏不改变自动 Probe 是否写入当前 PTY，也不保证目标 Shell、SSH、终端或服务器审计设施看不到 Probe。

#### Scenario: User reads the setting explanation

- **WHEN** 用户打开“通用”设置
- **THEN** 页面 MUST 同时展示开关当前值和关于本地 UI、PTY 写入及远程审计可见性的安全说明
