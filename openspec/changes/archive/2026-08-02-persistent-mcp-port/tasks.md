## 1. 设置与端口持久化

- [x] 1.1 以 TDD 方式在 `mcp-settings.ts` 增加可选 `port` 字段与白名单校验（1-65535 整数），更新存储测试
- [x] 1.2 在 `embedded-mcp-server.ts` 支持 `start(preferredPort?)` 与 `EADDRINUSE` 回退，先写固定端口/占用回退测试

## 2. 控制器接线

- [x] 2.1 `mcp-controller.ts` 首次启用分配默认端口 18789，`refreshServer()` 以 `settings.port` 启动并在实际端口变化时回写设置
- [x] 2.2 控制器测试：停用-启用端口不变、设置文件持久化端口

## 3. 验证

- [x] 3.1 运行 `pnpm verify` 与 MCP 专项测试
- [x] 3.2 运行 `openspec validate persistent-mcp-port --strict` 并产出验证记录
