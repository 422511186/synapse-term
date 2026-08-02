## ADDED Requirements

### Requirement: Platform-Safe Core IPC Endpoint
Core 与 Desktop Main MUST 为同一 appId 和当前 OS 用户推导相同的本地 IPC endpoint。POSIX Unix-domain socket 路径 MUST 在 UTF-8 字节长度上低于 Darwin 支持上限，并在用户临时目录过长时使用确定的短路径回退；Windows Named Pipe 格式 MUST 保持兼容。

#### Scenario: Long macOS temporary directory
- **WHEN** macOS 用户临时目录与 appId 组合会生成超长 socket 路径
- **THEN** Core 与 Desktop Main MUST 得到相同、可绑定且不超过安全字节上限的短 Unix socket 路径

#### Scenario: Existing Windows endpoint
- **WHEN** 系统运行在 Windows
- **THEN** endpoint MUST 保持当前用户范围的 `\\\\.\\pipe\\` Named Pipe 格式

#### Scenario: Distinct user scopes
- **WHEN** 两个不同 OS 用户启动同一 appId 的 Core
- **THEN** 两者 MUST 得到不同的 endpoint，且不得共享认证 token
