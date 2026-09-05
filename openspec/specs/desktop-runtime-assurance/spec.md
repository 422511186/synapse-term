# desktop-runtime-assurance Specification

## Purpose
规定 Electron Preload、Main Terminal Host 与 Renderer 工作区之间的运行时契约，以及真实桌面运行时的可识别失败边界。

## Requirements

### Requirement: Main-Process Terminal Host Contract
Electron Main MUST 在主进程中实例化并持有 `@synapse-term/session-runtime`，通过 Desktop IPC adapter 处理 Session 与 PTY 操作，并只向 Renderer 暴露受限的 preload API；Renderer MUST NOT 直接访问 Node API、PTY、`SessionRuntime` 或 `SessionActor` 内部对象。Session 运行行为不得因为从 app 下沉到 package 而转移给 Renderer。

#### Scenario: Renderer requests a session operation
- **WHEN** Renderer 调用 `sessions:create`、`terminal:write` 或订阅 `terminal:output`
- **THEN** 请求经 preload 通道到达 Main 的 IPC adapter，由其调用 Main 持有的 `SessionRuntime` 并返回经过校验的结果

#### Scenario: Runtime implementation is reused without exposing Main internals
- **WHEN** 未来 TUI 或本地 Web renderer 需要复用 Session 行为
- **THEN** 运行端可以依赖 `@synapse-term/session-runtime` 的公共出口，但不得 import `apps/desktop/src/main`、PTY 对象或 Session 内部状态

### Requirement: Complete DesktopApi Contract
Electron Preload MUST 仅暴露声明的 `DesktopApi`：可选平台标识、Session、终端、应用状态、通用设置、主题及本机 MCP 管理。请求 MUST 映射到经过校验的 Main 操作，事件 MUST 使用声明的窄 IPC 通道。`DesktopApi.mcp` MUST 限于设置、运行状态、Token、Sharing、审批管理和相关事件订阅。Renderer MUST NOT 直接访问 Node API、PTY、Session 内部对象、设置文件或 MCP HTTP 端点；preload MUST NOT 提供任意 IPC 转发或 `synapse_*` 工具调用。`DesktopApi` MUST NOT 包含 Agent、Provider、模型、ACP、审计、附件或资源监控操作。本地管理能力 MUST NOT 向外部客户端暴露，外部客户端只能通过内嵌 MCP Server 访问已显式共享的 Session。

#### Scenario: Invoke declared DesktopApi operations
- **WHEN** Renderer 调用声明的 Session、终端、应用状态、通用设置或主题操作
- **THEN** Main MUST 通过对应 IPC handler 调用 `SessionRuntime`、设置控制器或主题处理逻辑，并返回声明的结果

#### Scenario: Receive Session updates
- **WHEN** Main 广播有效的 `session:changed` 事件
- **THEN** Preload MUST 将它作为 Session 变化事件送达 Renderer，且不得暴露未声明的 IPC 通道

#### Scenario: Reject undeclared renderer access
- **WHEN** Renderer 尝试调用未在 `DesktopApi` 中声明的通道
- **THEN** Main MUST 拒绝该请求且不得转发

#### Scenario: Manage MCP through the restricted preload API
- **WHEN** 用户在桌面端管理 MCP 设置或 Token、查看运行状态、共享或取消 Sharing、查看已共享 Session 或响应审批卡片
- **THEN** Renderer MUST 通过 `DesktopApi.mcp` 的声明方法请求对应 Main handler，由 Main 持有的 `McpController` 处理，不得直接访问设置文件、MCP HTTP 端点或任意工具调用入口

#### Scenario: Receive theme and MCP events
- **WHEN** Main 广播声明的 `theme:changed`、`mcp:approval`、`mcp:approval-closed` 或 `mcp:execution` 事件
- **THEN** Preload MUST 通过对应的类型化订阅方法交付事件，并提供取消订阅函数，不得向 Renderer 暴露通用 IPC 对象

#### Scenario: Keep desktop management separate from external access
- **WHEN** 外部客户端连接内嵌 MCP Server
- **THEN** 外部客户端 MUST 仅获得 `mcp-access` 定义的八个 `synapse_*` 工具并以显式共享的 `sessionId` 寻址，MUST NOT 获得 `DesktopApi.mcp` 的 Session 列表、设置、Token 或审批管理能力

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
