# desktop-runtime-assurance Delta

## ADDED Requirements

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
