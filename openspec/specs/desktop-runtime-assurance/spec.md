# desktop-runtime-assurance Specification

## Purpose
规定 Electron Preload、Main Terminal Host 与 Renderer 工作区之间的运行时契约，以及真实桌面运行时的可识别失败边界。

## Requirements

### Requirement: Main-Process Terminal Host Contract
Electron Main MUST 通过 `terminal-host.ts` 持有 Session 与 PTY，并只向 Renderer 暴露受限的 preload API；Renderer MUST NOT 直接访问 Node API、PTY 或 Session 内部对象。

#### Scenario: Renderer requests a session operation
- **WHEN** Renderer 调用 `sessions:create`、`terminal:write` 或订阅 `terminal:output`
- **THEN** 请求经 preload 通道到达 Main 的 Terminal Host 处理，并返回经过校验的结果

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
生产 Electron Renderer MUST 优先使用 preload 暴露的 `window.synapseTerm`。浏览器测试替身仅可在 preload 不存在时使用，且其接口行为 MUST 与 `DesktopApi` 契约一致。

#### Scenario: Electron preload is present
- **WHEN** Electron 向 Renderer 注入真实 `window.synapseTerm`
- **THEN** 工作区 MUST 使用该对象读取、创建、切换和关闭 Session，并不得用 fixture 覆盖其返回值

#### Scenario: Browser regression environment
- **WHEN** Renderer 在没有 Electron preload 的浏览器测试环境加载
- **THEN** 系统 MAY 使用同接口的测试替身，并且测试 MUST 能验证对该接口的实际调用
