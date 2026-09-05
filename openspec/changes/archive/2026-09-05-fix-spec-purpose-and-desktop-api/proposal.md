## Why

全库 strict 校验因 `interaction-feedback`、`literal-shell-audit` 和 `macos-build-packaging` 的 `Purpose` 过短而失败；`desktop-runtime-assurance` 还保留禁止 MCP 的旧 `DesktopApi` 描述，与 ADR-0014、ADR-0015、现有 MCP 规格及受限 preload API 实现冲突。需要修正规格，使校验结果和桌面运行时契约准确反映已有能力。

## What Changes

- 根据各自现有需求补全三份规格的 `Purpose`，移除字面 Shell 审计规格的占位说明。
- 修正 `Complete DesktopApi Contract`，明确 Session、终端、应用状态、通用设置、主题及本机 MCP 管理能力和事件边界。
- 区分本地 Renderer 的 Sharing 管理与外部客户端的 MCP 工具访问，保留 IPC 白名单、Renderer 隔离及禁止外部 Session 枚举的限制。
- 保留现有需求和场景，仅补充已实现的 MCP 管理与事件场景；不改变应用代码、协议、权限或依赖。

## Capabilities

### New Capabilities

无。本变更修正文档，不新增产品能力。

### Modified Capabilities

- `desktop-runtime-assurance`：将 `Complete DesktopApi Contract` 对齐当前受限 preload API 及 MCP 管理边界。

## Impact

- 修改 `openspec/specs/desktop-runtime-assurance/spec.md`，并维护对应 delta spec。
- 仅更新 `interaction-feedback`、`literal-shell-audit` 和 `macos-build-packaging` 主规格的 `Purpose`；这些说明文字修订不新增或修改需求。
- 依据为 `apps/desktop/src/shared/contracts.ts`、`desktop-ipc-channels.ts`、`preload/preload-api.ts`、Main IPC handlers、当前 MCP 规格和生效 ADR。
- 验证覆盖全库 OpenSpec strict 校验、既有 Desktop IPC/preload/依赖方向测试、格式检查及提交差异检查。
