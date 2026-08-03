# desktop-runtime-assurance Specification

## Purpose
规定 Electron Preload、Core 通道和 Renderer 工作区之间的运行时契约，以及真实桌面运行时的可识别失败边界。
## Requirements
### Requirement: Complete DesktopApi Contract
Electron Preload MUST 仅暴露声明的 `DesktopApi`，且每个公开请求方法 MUST 映射到经过 schema 校验的 Desktop Main/Core 操作；Session、终端输出、资源和 Agent Timeline 的运行时事件 MUST 以窄 IPC 通道送达 Renderer。

#### Scenario: Invoke declared DesktopApi operations
- **WHEN** Renderer 调用任一声明的会话、终端、资源、Agent、Provider、模型、审计或 Core 操作
- **THEN** Desktop Main MUST 将其映射到对应的经过 schema 校验的 Core 请求或受控退出动作

#### Scenario: Receive Session updates
- **WHEN** Core 广播有效的 `session.changed` 事件
- **THEN** Preload MUST 将它作为 Session 变化事件送达 Renderer，且不得暴露未声明的 IPC 通道

#### Scenario: Reject undeclared renderer access
- **WHEN** Renderer 尝试调用未在 `DesktopApi` 中声明的通道
- **THEN** Desktop Main MUST 拒绝该请求且不得向 Core 转发

### Requirement: Real Electron Runtime Readiness
在支持的桌面平台上，已打包或开发态 Electron MUST 能建立真实 Core 连接，并完成不依赖外部 Provider 凭据的最小会话生命周期。

#### Scenario: Exercise the local session lifecycle
- **WHEN** Electron 启动并存在可用本地 Shell
- **THEN** Renderer MUST 通过真实 Preload API 获得 Core 状态和 Shell 环境，创建 Session、写入或重放终端数据、读取会话资源结果，并关闭该 Session

#### Scenario: Surface a local runtime failure
- **WHEN** Core 连接、本地 Shell 发现或 Session 创建失败
- **THEN** Renderer MUST 显示可识别的错误状态，而不得以 mock 或静态成功状态替代失败

### Requirement: Runtime-Backed Workspace Data
生产 Electron Renderer MUST 优先使用 preload 暴露的 `window.terminalAgent`。浏览器测试替身仅可在 preload 不存在时使用，且其接口行为 MUST 与 `DesktopApi` 契约一致。

#### Scenario: Electron preload is present
- **WHEN** Electron 向 Renderer 注入真实 `window.terminalAgent`
- **THEN** 工作区 MUST 使用该对象读取、创建、切换和关闭 Session，并不得用 fixture 覆盖其返回值

#### Scenario: Browser regression environment
- **WHEN** Renderer 在没有 Electron preload 的浏览器测试环境加载
- **THEN** 系统 MAY 使用同接口的测试替身，并且测试 MUST 能验证对该接口的实际调用

### Requirement: Core Connection Handshake Resource Release
CoreSupervisor 在获取连接后若 handshake 抛出异常，MUST 关闭该连接并向上传播错误，MUST NOT 泄漏 socket 与文件描述符。当连接来自本变更自启的 Core 进程时，handshake 失败后 MUST 同时停止 launcher，MUST NOT 留下无人管理的 Core 子进程；当连接来自已存在的 Core 时，MUST NOT 停止 launcher。

#### Scenario: Handshake throws after existing core connection
- **WHEN** `connector.connect()` 成功获取到已有 Core 的连接，但 `handshake()` 抛出异常
- **THEN** Supervisor MUST 调用 `connection.close()` 释放连接后重新抛出，MUST NOT 停止 launcher

#### Scenario: Handshake fails after self-started core
- **WHEN** Supervisor 因无可用连接而 `launcher.start()` 启动 Core，随后 handshake 抛异常或返回失败
- **THEN** Supervisor MUST 关闭连接并调用 `launcher.stop()` 停止自启的 Core 子进程

### Requirement: Core Process Stop on Exit Failure
CoreSupervisor 的 `requestExit('terminate_all')` 在 `core.shutdown` 请求抛错或超时后，MUST 仍关闭连接并停止 launcher，MUST NOT 让 Core 子进程在无人管理下继续运行。

#### Scenario: Shutdown request rejects
- **WHEN** `core.shutdown` 请求因 Core 挂起而超时 reject
- **THEN** Supervisor MUST 在 finally 中执行 `#closeConnection()` 与 `launcher.stop()`，错误向上传播但资源已释放

### Requirement: Oversized IPC Payload Isolation
Core 和 Desktop MUST 对控制帧及终端输出帧执行统一的最大长度校验。单个输出或响应超过预算时，发送端 MUST 分片或返回有界的 `resource_exhausted` 错误，不得写出超限帧、半帧或因该错误销毁整个已认证连接。

#### Scenario: Large terminal output arrives while closing a Session
- **WHEN** 用户调用 `sessions:close`，同时任一 Session 产生超过单帧预算的 PTY 输出
- **THEN** Desktop/Core IPC 连接 MUST 保持可用，关闭请求 MUST 收到成功响应或可识别的业务错误
- **AND** 系统 MUST NOT 仅将底层 `FramingError` 作为 `sessions:close` 的唯一错误说明

#### Scenario: Control response exceeds the frame budget
- **WHEN** 某个 Core 请求结果序列化后超过控制帧预算
- **THEN** Core MUST 返回有界的 `resource_exhausted` 协议错误或分段结果
- **AND** 后续只读请求 MUST 仍可通过同一 IPC 连接执行

### Requirement: Renderer Attachment Selection
Electron DesktopApi 必须新增受控的附件选择通道，Renderer 不得直接访问 Node.js 文件系统。Main 进程 MUST 通过 Electron `dialog` 或等价安全的文件选择器打开文件，限制图片/文件数量与大小，返回名称、MIME、大小和本地 `sourcePath`；返回失败或取消时 MUST 不产生附件。Renderer 提交 Agent 任务时，必须把附件元数据连同 `agent.start` payload 发送给 Core。

#### Scenario: Pick a file from the desktop
- **WHEN** 用户在 Composer 点击文件入口
- **THEN** Main 打开系统文件选择器，用户选择后被选文件 MUST 裁剪到约定数量和大小，并返回声明只读的元数据

#### Scenario: Pick an image from the desktop
- **WHEN** 用户在 Composer 点击图片入口
- **THEN** Main 只接受允许的 `image/png`、`image/jpeg`、`image/webp`、`image/gif` 文件，拒绝超大图片并返回可识别错误

#### Scenario: Cancel the file dialog
- **WHEN** 用户取消系统文件选择器
- **THEN** Preload MUST 返回空选择且不修改 Composer 现有附件

### Requirement: Desktop API Attachment Contract
`DesktopApi.agent.start` MUST 接受与 Core 一致的 `attachments` 参数，并将字段映射到经过 Schema 校验的 `agent.start` Core 请求。Preload 声明、Desktop Main 转发和 Core Protocol payload 的附件字段 MUST 保持一致，任何一层拒绝附件时 MUST 以原字段原文的语言返回给 Renderer。

#### Scenario: Attachment fields reach Core
- **WHEN** Renderer 调用带两份附件的 `agent.start`
- **THEN** Preload 和 Desktop Main 均不丢弃或改写 attachment 字段，Core 收到相同元数据

#### Scenario: Unknown attachment field is rejected
- **WHEN** Renderer 或测试调用带未知 attachments 字段的 IPC
- **THEN** Schema 校验拒绝请求并返回明确的校验错误，不得将非法字段转发给 Core AgentCoordinator

### Requirement: Oversized Attachment Defense in Depth
Desktop Main 和 Core 都必须执行附件大小预算，不能只依赖 Renderer，单个响应或 payload 超过控制帧预算时 MUST 按协议返回有界的 `resource_exhausted` 或附件限制错误，不能破坏 IPC 连接。

#### Scenario: Oversized image reaches Main
- **WHEN** 用户通过特殊途径尝试提交超过 10 MiB 的图片
- **THEN** Main 或 Core 校验拒绝，IPC 连接继续可用

#### Scenario: Aggregate attachments exceed frame budget
- **WHEN** 附件元数据和图片内容编译后超过控制帧预算
- **THEN** Core 返回有界错误且不创建部分 Agent Task
