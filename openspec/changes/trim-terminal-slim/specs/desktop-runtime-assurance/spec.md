## ADDED Requirements

### Requirement: Main-Process Terminal Host Contract
Electron Main MUST 通过 `terminal-host.ts` 持有 Session 与 PTY，并只向 Renderer 暴露受限的 preload API；Renderer MUST NOT 直接访问 Node API、PTY 或 Session 内部对象。

#### Scenario: Renderer requests a session operation
- **WHEN** Renderer 调用 `sessions:create`、`terminal:write` 或订阅 `terminal:output`
- **THEN** 请求经 preload 通道到达 Main 的 Terminal Host 处理，并返回经过校验的结果

## MODIFIED Requirements

### Requirement: Complete DesktopApi Contract
Electron Preload MUST 仅暴露声明的 `DesktopApi`，且每个公开请求方法 MUST 映射到经过校验的 Main 操作；Session 与终端输出事件 MUST 以窄 IPC 通道送达 Renderer。DesktopApi MUST NOT 包含 Agent、Provider、模型、MCP、ACP、审计、附件或资源监控操作。

#### Scenario: Invoke declared DesktopApi operations
- **WHEN** Renderer 调用声明的会话、终端或 Core 状态操作
- **THEN** Main MUST 将其映射到对应的 Terminal Host 操作或受控退出动作

#### Scenario: Receive Session updates
- **WHEN** Main 广播有效的 `session.changed` 事件
- **THEN** Preload MUST 将它作为 Session 变化事件送达 Renderer，且不得暴露未声明的 IPC 通道

#### Scenario: Reject undeclared renderer access
- **WHEN** Renderer 尝试调用未在 `DesktopApi` 中声明的通道
- **THEN** Main MUST 拒绝该请求且不得转发

### Requirement: Real Electron Runtime Readiness
在支持的桌面平台上，已打包或开发态 Electron MUST 能完成不依赖外部服务的本地终端生命周期。

#### Scenario: Exercise the local session lifecycle
- **WHEN** Electron 启动并存在可用本地 Shell
- **THEN** Renderer MUST 通过真实 Preload API 获得 Shell 环境，创建 Session、写入或重放终端数据，并关闭该 Session

#### Scenario: Surface a local runtime failure
- **WHEN** 本地 Shell 发现或 Session 创建失败
- **THEN** Renderer MUST 显示可识别的错误状态，而不得以 mock 或静态成功状态替代失败

### Requirement: Runtime-Backed Workspace Data
生产 Electron Renderer MUST 优先使用 preload 暴露的 `window.terminalAgent`。浏览器测试替身仅可在 preload 不存在时使用，且其接口行为 MUST 与 `DesktopApi` 契约一致。

#### Scenario: Electron preload is present
- **WHEN** Electron 向 Renderer 注入真实 `window.terminalAgent`
- **THEN** 工作区 MUST 使用该对象读取、创建、切换和关闭 Session，并不得用 fixture 覆盖其返回值

#### Scenario: Browser regression environment
- **WHEN** Renderer 在没有 Electron preload 的浏览器测试环境加载
- **THEN** 系统 MAY 使用同接口的测试替身，并且测试 MUST 能验证对该接口的实际调用

## REMOVED Requirements

### Requirement: Core Connection Handshake Resource Release
**Reason**: CoreSupervisor 与跨进程握手已删除。
**Migration**: 无替代；Main 内直接创建并持有 Terminal Host。

### Requirement: Core Process Stop on Exit Failure
**Reason**: Core 子进程启动/停止逻辑已删除。
**Migration**: 应用退出时 Main 统一关闭 Session。

### Requirement: Oversized IPC Payload Isolation
**Reason**: 跨进程帧协议已删除，Renderer 与 Main 使用 Electron IPC。
**Migration**: 终端输出仍按有界分片广播，见 terminal-sessions 的 Bounded Ordered Terminal Output Frames。

### Requirement: Renderer Attachment Selection
**Reason**: Agent 附件功能已删除。
**Migration**: 未来重实现 Agent 时重新设计。

### Requirement: Desktop API Attachment Contract
**Reason**: `agent.start` 与附件字段已删除。
**Migration**: 未来重实现 Agent 时重新设计。

### Requirement: Oversized Attachment Defense in Depth
**Reason**: 附件大小预算随 Agent 附件删除。
**Migration**: 未来重实现 Agent 时重新设计。
