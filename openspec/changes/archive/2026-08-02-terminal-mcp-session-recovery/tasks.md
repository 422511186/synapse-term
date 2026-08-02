## 1. 协议与 Core 用例

- [x] 1.1 以 TDD 在 `packages/protocol/src/core-api/core-api.ts` 新增 `external.terminalStatus` 用例（sessionId + caller + approvalMode 入参），并补充 `parseCoreRequest` 测试
- [x] 1.2 在 `packages/application/src/router/core-request-router.ts` 路由 `external.terminalStatus` 到 ExternalRequestHandler，并补充路由测试

## 2. 会话状态探测与缓存清理

- [x] 2.1 以 TDD 在 `ExternalRequestHandler` 实现 `terminalStatus`：存在且共享且 PTY running 返回 `ready`/`not_ready`；不存在、未共享或 PTY 非 running 返回 `expired` 且不抛错
- [x] 2.2 以 TDD 在 `#session()` 与 `terminalStatus` 中对失效会话清理 `#pipelines` 缓存注册，并补充“会话移除后缓存清理、同 id 重建使用新管线”测试
- [x] 2.3 为 `terminal_status` 记录 `external.status` 审计事件（来源、sessionId、状态）
- [x] 2.4 修复外部执行路径缺少懒探测：`ExternalToolPipeline.execute` 在 Shell 未就绪/环境未验证时先运行 `ShellProbe`（与内置 Agent 同语义），探测失败返回可恢复的 `session_not_ready`；`ShellProbe` 支持外部租约（`ownerKind: 'external'`）并补充管线与探测测试

## 3. MCP 边界稳定错误码

- [x] 3.1 以 TDD 在 `mcp-tools.ts` 增加错误格式化：`session_not_ready` → `SESSION_NOT_READY`、`invalid_session` → `SESSION_EXPIRED`、`lease_unavailable` → `SESSION_BUSY`、`transaction_not_found` → `TRANSACTION_NOT_FOUND`，其余内部码保持，文本含恢复指引
- [x] 3.2 新增 `mcp-tools.test.ts`：错误结果文本以稳定错误码开头且包含指引；`invalid_session` 异常映射为 `SESSION_EXPIRED` 且不泄露其他会话信息
- [x] 3.3 修复跨 IPC 错误码丢失：`invalid_session`、`transaction_not_found` 加入协议 `ERROR_CODES` 白名单，并补 CoreIpcServer 回归测试（原错误被归一化为 `internal_error` 导致 `SESSION_EXPIRED` 映射失效）

## 4. MCP 工具面收敛

- [x] 4.1 移除 `local_list_files`、`local_search_files`、`local_read_file` 的 MCP 工具注册与 `runMcpTool` 分支
- [x] 4.2 注册 `terminal_status` MCP 工具（输入 sessionId，输出状态与恢复提示）
- [x] 4.3 更新 `embedded-mcp-server.test.ts`：`tools/list` 只含五个 `terminal_*` 工具；`terminal_status` 调用翻译到 `external.terminalStatus`

## 5. 验证

- [x] 5.1 运行 `pnpm test` 相关专项测试（protocol、application、desktop mcp）并全部通过
- [x] 5.2 运行 `openspec validate terminal-mcp-session-recovery --strict` 并产出验证记录
- [x] 5.3 运行 `pnpm verify`（类型检查、lint、全量测试）确认无回归
