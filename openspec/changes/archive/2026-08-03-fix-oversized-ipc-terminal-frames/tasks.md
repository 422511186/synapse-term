## 1. 协议帧预算与 UTF-8 分片

- [x] 1.1 在 `packages/protocol/src/core-api/framing.test.ts` 先增加失败测试：大于默认上限的终端帧和控制帧必须被拒绝，UTF-8 文本分片拼接后必须保持原始字节；运行协议测试确认测试因能力缺失而失败
- [x] 1.2 在 `packages/protocol/src/core-api/framing.ts` 导出统一帧预算、终端输出分片预算和 UTF-8 安全分片 helper，并让两类 encoder 对最终 frame body 执行大小校验
- [x] 1.3 运行 `pnpm exec vitest run packages/protocol/src/core-api/framing.test.ts`，确认新增协议测试通过且既有 framing 测试不回归

## 2. Session 输出与回放分页

- [x] 2.1 在 `packages/terminal-service/src/execution/output-journal.test.ts` 和 `packages/application/src/router/core-request-router.test.ts` 增加失败测试：超大 PTY 输出必须产生多个递增事件，回放必须返回有界页面和续取游标；运行相关测试确认测试先失败
- [x] 2.2 在 `packages/terminal-service/src/execution/output-journal.ts` 增加按字节预算的 replay page，返回 `hasMore` 与 `nextAfterSequence`，并保持现有 cursor/read 调用兼容
- [x] 2.3 在 `packages/application/src/router/handlers/session-handler.ts` 使用协议 UTF-8 分片 helper，在 Journal 和 IPC 广播前拆分 PTY 输出；为 `terminal.replay` 使用固定预算并返回分页元数据
- [x] 2.4 更新 `packages/protocol/src/core-api/core-api.ts` 的 `TerminalReplay` schema 和相关共享类型，覆盖分页字段及现有调用方
- [x] 2.5 运行 `pnpm exec vitest run packages/terminal-service/src/execution/output-journal.test.ts packages/application/src/router/core-request-router.test.ts`，确认输出顺序、回放和关闭流程通过

## 3. Renderer 回放续取

- [x] 3.1 在 `packages/ui-platform/src/terminal/terminal-stream.test.ts` 增加失败测试：多页回放必须按 `nextAfterSequence` 合并，且只在最后一页合并挂起的实时事件
- [x] 3.2 修改 `packages/ui-platform/src/terminal/terminal-view.tsx` 和 `packages/ui-platform/src/terminal/terminal-stream.ts`，串行续取 `hasMore` 页面，保持 history gap、snapshot、实时事件去重和 sequence 语义
- [x] 3.3 更新 `apps/desktop/src/renderer/mock-api.ts`、preload 类型及相关测试夹具，补齐新增回放字段
- [x] 3.4 运行 `pnpm exec vitest run packages/ui-platform/src/terminal/terminal-stream.test.ts` 并执行 UI 类型检查

## 4. Core IPC 错误隔离与回归验证

- [x] 4.1 在 `packages/infrastructure/src/ipc/core-ipc-server.test.ts` 和 `apps/desktop/src/main/named-pipe-core-connector.test.ts` 增加失败测试：大输出不会断开已认证连接，超大控制结果返回 `resource_exhausted` 后仍可处理后续请求
- [x] 4.2 修改 `packages/infrastructure/src/ipc/core-ipc-server.ts`，对控制响应、事件和终端输出的编码失败执行有界错误处理，不写出超限帧或让异常逃逸为未处理 rejection
- [x] 4.3 增加 `sessions:close` 与并发大输出的回归测试，验证关闭请求收到成功响应或稳定业务错误，且随后 `session.list` 仍可用
- [x] 4.4 运行 `pnpm verify`、`pnpm test` 和 `openspec validate "fix-oversized-ipc-terminal-frames" --type change --strict --no-interactive`，记录实际结果并更新本 change 的任务状态
