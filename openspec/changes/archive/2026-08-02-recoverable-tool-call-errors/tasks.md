## 1. 可恢复工具错误

- [x] 1.1 以 TDD 方式在 `tool-gateway.ts` 中让 Schema 校验失败返回 `recoverable: true` 与解释性 `message`（新增 `formatToolCallValidationMessage`），先写失败测试
- [x] 1.2 在 `agent-runtime.test.ts` 新增集成测试：gateway 返回 recoverable 的 `invalid_tool_call` 时，运行时把错误回传模型并 `continue`，最终正常完成而非 `failed`
- [x] 1.3 确认 `approval_invalid`/`policy_denied` 等环境性错误不受影响，必要时补充断言

## 2. 验证

- [x] 2.1 运行 `pnpm verify` 全量验证（format/lint/typecheck/test）
- [x] 2.2 运行 `openspec validate recoverable-tool-call-errors --strict`
- [x] 2.3 产出验证记录
