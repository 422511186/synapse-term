## MODIFIED Requirements

### Requirement: General Probe Echo Preference

系统 MUST 在“通用”设置中提供“隐藏自动 Probe 回显”开关，默认值为开启（`true`），并明确说明该设置只控制本地终端 UI 的显示。开启时，终端 UI MUST 隐藏可识别的 Synapse Term 自动注入环境识别 Probe 和命令完成 Probe 的完整本地回显，即使回显被拆到多个 PTY 数据块、被终端自动换行或重绘控制序列分隔，或在匹配完成帧之后才到达；关闭时，终端 UI MUST 不主动抑制这些自动 Probe 回显，以便用户诊断实际终端回显行为。

#### Scenario: Default preference

- **WHEN** 用户首次启动桌面端并创建 Session
- **THEN** 系统 MUST 使用 `hideCompletionProbeEcho: true`，终端 UI 默认不显示环境识别 Probe 或命令完成 Probe 的本地回显

#### Scenario: Diagnostic visibility

- **WHEN** 用户在“通用”设置中关闭“隐藏自动 Probe 回显”，且 PTY 返回自动 Probe 的命令回显或结果回显
- **THEN** 本地终端 UI MUST 不主动抑制这些回显以便诊断，并 MUST 展示说明“Probe 仍会写入 PTY，远程服务器仍可能记录”

#### Scenario: Preference changes during an echoed Probe

- **WHEN** 用户在自动 Probe 回显仍可能继续到达时切换“隐藏自动 Probe 回显”开关
- **THEN** 后续交付给本地终端 UI 的回显 MUST 服从最新设置，已经交付的内容 MUST NOT 被回溯改写，协议消费者看到的输出和完成检测 MUST NOT 因该切换改变

### Requirement: UI-Only Probe Echo Filtering

探针可见性设置 MUST 只影响本地终端 UI 输出消费者。环境验证、OSC 777 控制帧隔离、完成检测、退出码、CommandExecutor 输出缓冲、外部客户端输出脱敏和 PTY 实际写入 MUST 在开关两种状态下保持一致。Probe MUST 继续以固定明文写入当前 PTY，并可能被目标 Shell、SSH、终端或服务器审计设施记录。

#### Scenario: Hidden UI echo

- **WHEN** 设置为隐藏且 PTY 返回环境识别 Probe 命令/结果或命令完成 Probe 输入回显和匹配 OSC 777 完成帧
- **THEN** 本地终端 UI MUST 隐藏可识别的自动 Probe 回显，ShellProbe/CommandExecutor MUST 仍能完成验证和事务收敛，且 PTY 写入内容 MUST 保持不变

#### Scenario: Fragmented wrapped and redrawn echo

- **WHEN** 自动 Probe 回显的身份标记和结束边界被拆分在多个 PTY 数据块中，并且中间包含终端自动换行、ANSI/重绘控制序列或部分控制序列
- **THEN** 隐藏设置下本地终端 UI MUST 隐藏完整的自动 Probe 回显，且 MUST 保留 Probe 前后以及不属于该 Probe 的用户命令、普通输出和提示符

#### Scenario: Completion frame precedes delayed echo

- **WHEN** 匹配的 OSC 777 完成帧先于命令完成 Probe 输入回显的最后一段到达，并且该回显仍在回显收尾窗口内到达
- **THEN** 本地终端 UI MUST 继续隐藏该自动 Probe 回显，CommandExecutor MUST 保持已确认的事务状态、退出码和输出内容不变，普通延迟业务输出 MUST 继续保留

#### Scenario: Visible UI echo does not leak to MCP

- **WHEN** 设置为显示且 PTY 返回环境识别 Probe 或命令完成 Probe
- **THEN** UI MAY 收到自动 Probe 回显，但 CommandExecutor 和外部客户端输出 MUST 继续过滤 Probe 协议噪声且 MUST NOT 收到 OSC 777 控制帧
