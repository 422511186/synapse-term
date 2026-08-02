## 1. 协议与审批管线

- [x] 1.1 以 TDD 在 `packages/protocol/src/core-api/core-api.ts` 的 `externalApprovalModeSchema` 新增 `'full'` 取值，并补充 `parseCoreRequest` 接受 full 的测试
- [x] 1.2 在 `packages/platform-kernel/src/gateway/external-tool-pipeline.ts` 的 `ExternalApprovalMode` 新增 `'full'`，`decideExternalAuthorization` 在 full 模式下对所有风险级别返回 allowed，并补充 full 模式放行高危命令的测试

## 2. 桌面设置与持久化

- [x] 2.1 `McpApprovalMode`（`mcp-settings.ts` 与 `preload-api.ts`）新增 `'full'`，`sanitizeMcpSettings` 白名单接受 full，未知值仍回退 read_only，并补充存储测试
- [x] 2.2 `mcp-settings-view.tsx` 审批模式区块新增“完全权限模式”按钮与高风险提示，网格适配三列布局
- [x] 2.3 `mcp-tools.ts` 的 `terminal_execute` 工具描述补充 full 模式说明
- [x] 2.4 `mcp-controller.test.ts` 补充 `setApprovalMode('full')` 持久化与状态返回用例
- [x] 2.5 修复主进程 `registerMcpIpc` 的 `mcp:set-approval-mode` 归一化把 `full` 吞成 `read_only` 的问题：提取 `normalizeMcpApprovalMode` 到 `mcp-settings.ts` 并接入 IPC，补充白名单/回退测试

## 3. 验证

- [x] 3.1 运行 `openspec validate mcp-full-permission-mode --strict` 并产出验证记录
- [x] 3.2 运行相关专项测试（protocol、platform-kernel、desktop mcp）并全部通过
- [x] 3.3 运行 `pnpm verify`（类型检查、lint、全量测试）确认无回归
