## ADDED Requirements

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
