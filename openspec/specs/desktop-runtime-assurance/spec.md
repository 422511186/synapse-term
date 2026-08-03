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

