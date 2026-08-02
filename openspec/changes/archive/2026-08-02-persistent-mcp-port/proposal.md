## Why

当前内嵌 MCP 端点每次启动都用端口 0 随机分配（`listen(0)`），外部客户端复制的连接串在应用重启或 MCP 停用再启用后会失效，用户必须反复复制新连接串。

## What Changes

- MCP 设置新增持久化 `port` 字段：首次启用时使用默认端口（18789）并写入设置；后续启用/停用/重启复用同一端口。
- `EmbeddedMcpServer.start()` 支持指定端口；首选端口被占用（`EADDRINUSE`）时回退到临时端口，并把实际端口持久化，保证下一次仍稳定。
- 连接串与设置页端口展示始终反映当前实际监听端口。

## Capabilities

### New Capabilities

### Modified Capabilities
- `mcp-access`: 新增"稳定回环端口"要求，规定端口跨重启/停用-启用保持不变及占用回退语义。

## Impact

- `apps/desktop/src/mcp/mcp-settings.ts`：设置白名单新增 `port` 字段（1-65535 整数）。
- `apps/desktop/src/mcp/embedded-mcp-server.ts`：`start(preferredPort?)` 支持固定端口与 EADDRINUSE 回退。
- `apps/desktop/src/mcp/mcp-controller.ts`：启用时分配默认端口、启动后持久化实际端口。
- 测试：设置存储、server 固定端口/占用回退、controller 停用-启用端口不变。
- 无 IPC 契约或 UI 结构变更；设置页端口展示逻辑不变。
