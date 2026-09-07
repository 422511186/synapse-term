## MODIFIED Requirements

### Requirement: Sanitized External PTY History

对外 PTY 输出历史 MUST 在分页之前完成协议帧隔离、自动 Probe 隔离和输出脱敏。外部客户端 MUST 只收到清理后的文本，不得收到原始 PTY 字节流、OSC 777 控制帧、自动 Probe 原文、未回显的原始按键或 ANSI 屏幕快照。文件载荷、文件协议及本地功能的内部结构化快照 MUST 在进入历史之前分流，不得以脱敏或截断代替隔离；普通明文操作命令、普通结果和用户可读文本 MUST 继续遵循原 Sharing 输出边界。

#### Scenario: Probe and control frames are excluded

- **WHEN** PTY 输出包含用户文本、自动 Probe 回显和 OSC 777 完成帧
- **THEN** 外部历史 MUST 只包含协议隔离后的普通可读文本，Probe 回显和控制帧不得作为分页内容返回

#### Scenario: Secret crosses a page boundary

- **WHEN** 疑似凭据文本跨越内部输出块或外部响应页边界
- **THEN** 系统 MUST 先在连续历史上完成脱敏，再按 `afterCursor` 和 `maxBytes` 分页，不得因分页边界泄露凭据片段

#### Scenario: Observe while a local file transfer is active

- **WHEN** 外部客户端在本地文件传输期间读取同一已 Sharing Session 的历史
- **THEN** 普通脱敏文本 MUST 仍可观察，文件内容、编码数据块和传输协议 MUST 不出现于分页或即时输出

#### Scenario: Local protocol is interrupted mid-frame

- **WHEN** 文件协议在半帧处取消、失败或超限
- **THEN** 后续清理 MUST 不把载荷残片当作普通文本写入 Sharing 历史，普通用户文本仍按顺序处理

#### Scenario: A readable local command is echoed

- **WHEN** Sharing 之后 PTY 回显明文上传/下载或采集命令及普通可读结果
- **THEN** 这些普通文本 MUST 继续按现有规则进入脱敏历史，不能因功能仅面向桌面 UI 就承诺其对外完全不可见

## ADDED Requirements

### Requirement: Local Capabilities Do Not Expand Sharing Authorization

Sharing MUST 不向外部客户端授予本地文件选择、原始文件数据、快照结构或本地操作句柄。现有 MCP 工具、审批模式和输出脱敏边界 MUST 保持；本地操作与 Sharing 的授权生命周期 MUST 分离。取消 Sharing、停用 MCP 或吊销 Token MUST 仅撤销外部能力，不能终止用户正在进行的本地文件操作；Session 关闭仍清理两者。

#### Scenario: External caller requests local capability handles

- **WHEN** 外部客户端通过既有工具请求本地文件引用、传输句柄或快照结构
- **THEN** 系统 MUST 不提供这些能力，不增加绕过 Sharing 或审批的工具入口

#### Scenario: Unshare during a local upload

- **WHEN** 用户上传期间取消 Sharing 或吊销 MCP Token
- **THEN** 外部调用 MUST 按既有撤销语义失效，本地上传继续由其 Session 操作资格控制，不因 MCP 清理而被取消
