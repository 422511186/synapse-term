## Why

PTY 的单次输出可能超过 Core IPC 的 8 MiB 单帧上限，但当前发送端会把整块输出直接编码成一个帧，导致 Desktop 解码失败并销毁 Core 连接。用户最终看到的是 `sessions:close` 失败，即使关闭请求本身很小，且会话状态可能已经在 Core 中发生变化。

## What Changes

- 为终端输出定义受 IPC 帧上限约束的安全分片边界，并在写入日志和广播前将大块 PTY 输出按 UTF-8 安全边界拆分。
- 保持分片后的输出顺序和严格递增 sequence，使实时订阅、日志和终端回放使用同一事件序列。
- 限制终端回放响应的大小并支持按 sequence 继续获取，避免回放或快照生成超大控制帧。
- 在控制帧和终端输出帧编码处增加大小保护，在传输层测试大输出、回放和关闭期间输出不会断开连接。
- 改善帧超限导致的连接断开诊断，避免把底层传输错误误认为 `sessions:close` 业务错误。

## Capabilities

### New Capabilities

### Modified Capabilities

- `terminal-sessions`: 终端输出事件和回放 MUST 遵守 IPC 帧大小边界，并在大输出时保持可重放的有序分片。
- `desktop-runtime-assurance`: Desktop/Core IPC 遇到大终端输出时 MUST 保持连接可用，关闭等请求不得因并发输出帧超限而无提示地丢失。

## Impact

- 影响 `packages/protocol` 的 Core IPC framing、`packages/terminal-service` 的输出日志、`packages/application` 的 Session handler、`apps/core` 的输出广播和 `apps/desktop` 的 Core connector。
- 影响 `terminal.replay` 的响应分页或大小限制，以及 Renderer 的回放续取逻辑。
- 不引入数据库迁移，不扩大工具权限，不改变 Session、MCP 或 ACP 的安全边界。
