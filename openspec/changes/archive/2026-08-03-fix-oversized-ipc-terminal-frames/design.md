## Context

当前 Core IPC 使用 4 字节长度前缀，将控制消息和终端输出复用在同一条本地 socket 上。`FrameDecoder` 默认拒绝超过 8 MiB 的帧，但 PTY 的单次 `onData` 回调大小不受平台或 `node-pty` 契约约束；Session handler 会把这整块数据同时写入 `OutputJournal` 并广播给 Desktop，因此大输出会使 Desktop 解码器销毁连接。

`terminal.replay` 还存在第二条路径：OutputJournal 默认保留每个 Session 64 MiB，当前回放会一次返回所有可用事件，可能把超大输出包装成一个控制响应。修复必须同时约束实时帧和回放响应，否则实时路径修好后，断线重连仍可能复现同类问题。

## Goals / Non-Goals

**Goals:**

- 任何 Core IPC 发送帧都不得超过协议声明的最大帧长度。
- 大块 PTY 输出按 UTF-8 安全边界拆成连续的 Journal/广播事件，保持严格递增 sequence。
- 终端回放按字节预算分页，保留 `afterSequence` 续取能力，同时不改变现有增量回放的基本语义。
- 大输出、回放分页和关闭期间并发输出不会使 Desktop/Core socket 断开。
- 让传输层错误带有可识别的稳定错误码，便于区分业务关闭失败和连接层失败。

**Non-Goals:**

- 不提高 8 MiB 协议上限作为主要解决方案。
- 不改变 PTY、Session、MCP 或 ACP 的权限边界。
- 不改变数据库 schema、原始日志留存容量或终端 UI 的可见内容。
- 不对 Renderer 进行全量终端渲染重构。

## Decisions

### 1. 使用保守的输出和回放预算

协议包导出统一的帧上限，并定义 256 KiB 的终端输出分片预算和 512 KiB 的回放原始数据预算。输出预算远低于 8 MiB，可为 session id、sequence、JSON 控制响应和 UTF-8/JSON 转义开销留下空间。

编码器仍会检查最终 frame body 长度，防止未来调用方绕过分片。仅提高解码器上限会扩大单次内存分配和 socket 缓冲压力，不能作为修复。

### 2. 在 Session handler 边界分片

PTY 和 `SessionActor` 保持 transport-agnostic，Session handler 在写入 Journal 和调用 `emitTerminalOutput` 之前使用协议提供的 UTF-8 分片 helper。每个分片创建一个新的 Journal event 和 sequence；不复用同一 sequence，因为 Renderer 会把已确认 sequence 之前的事件视为重复并丢弃。

### 3. 回放使用有界 page

OutputJournal replay 增加可选的最大字节预算，并返回 `hasMore` 与 `nextAfterSequence`。Core 的 `terminal.replay` 保持请求形态不变，每次按固定预算返回一页；Renderer 在收到 `hasMore` 时以 `nextAfterSequence` 继续请求，并在最后一页才合并正在等待的实时事件。

发生 history gap 时继续优先返回当前终端 snapshot；如果一个异常大的控制结果仍无法编码，Core MUST 返回小的 `resource_exhausted` 错误而不是销毁连接。

### 4. 编码失败采用 fail-closed 但保持连接

控制帧和终端输出帧编码时都校验大小。响应结果过大时，Core 将其转换为有界的协议错误响应；无法安全转换的非请求帧只记录并丢弃，不能写出半帧或让异常逃逸到进程级未处理 rejection。发送端不自动重试有副作用的 `session.close`，由上层通过列表/状态查询确认最终状态。

## Risks / Trade-offs

- [回放页数增加] 大日志回放会产生多次请求和 UI 等待 → 使用较大的固定页预算，并在 Renderer 中串行续取；sequence 保证不会重复显示。
- [UTF-8 分片成本] 需要逐 code point 计算字节长度 → 只在 PTY 输出跨越预算时执行分片，普通小输出保持原有路径。
- [异常 snapshot 仍可能过大] xterm 序列化长度受 scrollback 和行宽影响 → 编码器最终校验并返回 `resource_exhausted`，同时保留后续专门的 snapshot 分页改进空间。
- [输出突发仍可能造成背压] 分片解决单帧上限但不等于无限吞吐 → 本 change 保持现有 socket 写入模型，增加回归验证；独立的 write queue/backpressure 可另行设计。

## Migration Plan

这是协议内部的兼容性收紧，不需要数据库迁移。Core 与 Desktop 使用同一 workspace 版本发布；旧 Desktop 连接新 Core 时仍可完成握手，但旧客户端不理解回放分页字段时可按首包兼容读取，当前版本 Renderer 使用新字段续取。回滚只需回退代码版本，不涉及数据格式变更。

## Open Questions

- 是否在后续版本把 snapshot 从控制响应迁移为独立的分片流，取决于实际的超大 scrollback 使用数据；本 change 先保证连接不被异常结果摧毁。
