## MODIFIED Requirements

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
