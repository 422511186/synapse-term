# 验证记录

日期：2026-08-02

## 执行结果

- `pnpm verify`（format:check + lint + typecheck + vitest）：全部通过；146 个测试文件、694 个测试通过、13 个跳过。
- 专项测试：`tool-gateway.test.ts` 17 通过（含 invalid_tool_call recoverable 断言）、`agent-runtime.test.ts` 20 通过（含 invalid_tool_call 回传继续契约测试）。
- `pnpm exec playwright test`（完整 E2E）：33 通过、4 跳过、0 失败。
- `openspec validate recoverable-tool-call-errors --strict`：valid。

## 覆盖范围

- `packages/platform-kernel/src/gateway/tool-gateway.ts`：Schema 校验失败返回 `recoverable: true` 与 `formatToolCallValidationMessage` 生成的修复提示。
- `packages/agent-service/src/runtime/agent-runtime.ts`：既有 recoverable 分支被新数据驱动，错误作为 `tool_result` 回传模型继续 ReAct。
- 保留 `agent_loop_limit_reached` 防死循环上限；审批失效/策略拒绝等环境性错误语义未变。

## 协议影响

无 IPC、协议或 UI 变更；改动限于 ToolGateway 错误语义与运行时契约测试。
