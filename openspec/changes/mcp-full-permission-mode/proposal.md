## Why

MCP 外部审批目前只有 read-only / managed 两级：managed 只自动放行低危命令，unknown / privileged / destructive 一律拒绝且不可配置。对单用户本机自用场景，用户希望有一个“完全权限模式”：不审查命令、全部放行，避免外部客户端在可信终端里被策略引擎误伤或频繁被拒。

## What Changes

- MCP 审批模式新增 `full`（完全权限模式）：设置页出现第三个模式选项，选择后 MCP 端点对任何命令不再做风险审查，全部放行。
- 协议层 `externalApprovalModeSchema` 与 `ExternalApprovalMode` 类型新增 `full` 取值，`ExternalToolPipeline` 的审批裁决在 `full` 模式下对所有风险级别（含 unknown / privileged / destructive）返回 allowed。
- 设置持久化与 IPC 类型同步接受 `full`：`McpApprovalMode`、`sanitizeMcpSettings` 白名单、桌面 IPC 契约。
- 安全默认不变：未配置或配置损坏时仍回退 `read_only`；`full` 必须由用户在设置页显式选择，并带高风险提示文案。

## Capabilities

### New Capabilities

### Modified Capabilities
- `mcp-access`: “External Approval Configuration” 需求从两级审批扩展为三级（read-only / managed / full），明确 full 模式下任何风险级别的命令都自动放行，且必须由用户显式配置。

## Impact

- `apps/desktop/src/mcp/mcp-settings.ts`：`McpApprovalMode` 与 `sanitizeMcpSettings` 接受 `full`。
- `apps/desktop/src/mcp/mcp-settings-view.tsx`：设置页新增“完全权限模式”按钮与风险提示。
- `apps/desktop/src/preload/preload-api.ts`：`McpApprovalMode` IPC 契约新增 `full`。
- `apps/desktop/src/mcp/mcp-tools.ts`：`terminal_execute` 工具描述同步三级模式说明。
- `packages/protocol/src/core-api/core-api.ts`：`externalApprovalModeSchema` 新增 `full`。
- `packages/platform-kernel/src/gateway/external-tool-pipeline.ts`：`ExternalApprovalMode` 与审批裁决新增 `full` 放行分支。
- 测试：`mcp-settings`、`mcp-controller`、`core-api`、`external-tool-pipeline` 补充 full 模式用例。
