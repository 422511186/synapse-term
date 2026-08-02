## Context

`EmbeddedMcpServer.start()` 当前执行 `httpServer.listen(0, host)`，每次启动随机端口；`mcp-controller` 的 `refreshServer()` 在停用/启用循环中复用同一个 server 实例，但每次 `start()` 都会换新端口。外部客户端依赖连接串（含端口），端口漂移导致连接失效。

## Goals / Non-Goals

**Goals:**
- 端口在应用重启、MCP 停用-启用循环中保持不变。
- 端口持久化到设置文件，重启后无需重新复制连接串。
- 首选端口被占用时不阻塞启用，自动回退并持久化实际端口。

**Non-Goals:**
- 不改变回环监听、token 认证、审批模式等既有语义。
- 不引入固定端口冲突处理之外的端口管理 UI。

## Decisions

**D1：端口持久化到 `mcp/settings.json`，首次启用分配。**
`McpSettings` 增加可选 `port` 字段，sanitize 只接受 1-65535 整数。首次启用时若无端口则写入默认端口 18789；停用不清除端口。理由：固定常量端口可能被其他进程占用，持久化方案既满足"固定"体验又保留回退能力。

**D2：`EmbeddedMcpServer.start(preferredPort?)` 显式接收端口。**
控制器在调用时把当前 `settings.port` 传入，避免在 server 构造时捕获过期值（settings 会在启动后更新为实际端口）。`EADDRINUSE` 时回退 `listen(0)`，失败请求不留残留 listener。

**D3：启动后把实际端口回写设置。**
`refreshServer()` 在 `start()` 成功后比较 `server.status.port` 与 `settings.port`，不一致则保存，保证回退场景下下一次仍稳定。

## Risks / Trade-offs

- [默认端口 18789 与其他进程冲突] → 自动回退临时端口并持久化；冲突只影响首次启动。
- [回退后端口仍可能变化（极端情况下每次都被占用）] → 回退结果已持久化，下一次复用；可接受。

## Migration Plan

设置文件新增可选字段，旧设置无 `port` 时首次启用自动补齐；无数据迁移。
