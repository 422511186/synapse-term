## Why

当前桌面端虽然已接回部分 `DesktopApi`，但会话导航仍仅是无边界下拉菜单，活动会话没有稳定显示实际终端类型；会话数量增长后难以查找、切换或新建。更严重的是 macOS 的 Core Unix socket 路径超过平台长度限制，导致已打包 Electron 无法建立真实 IPC，界面在该环境下不能视为功能完整。

## What Changes

- 在桌面工作区加入可横向滚动的 Session 标签栏、固定的新建入口，以及包含搜索和受控滚动的全部会话视图；会话标签显示真实终端类型并提供可访问的关闭操作。
- 让 Session 运行时摘要携带可显示、可区分的终端类型，避免以用户输入的标题或仅执行方言代替 Shell/终端类型。
- 保持只挂载活动 xterm 的资源模型，在标签切换时通过现有 replay API 恢复输出，并让活动标签自动进入可视区域。
- 修复 macOS Core IPC endpoint 的路径策略，使短 Unix socket 路径在用户数据目录较长时仍可启动；保留 Windows Named Pipe 行为和现有安全边界。
- 建立 Renderer、Preload、Electron Main 和 Core 的运行时契约回归：验证会话、终端流、资源、Agent、审批、审计、模型和 Provider 操作实际经过 `DesktopApi`，并在真实 Electron 环境验证关键读写链路。

## Capabilities

### New Capabilities
- `desktop-runtime-assurance`: 定义桌面 UI 到真实 Preload、Main 和 Core 的端到端接口可用性、错误呈现与回归验收。

### Modified Capabilities
- `desktop-terminal`: 将 Session 标签页从基本创建/切换提升为可扩展的标签、类型可见性、搜索和溢出导航体验。
- `terminal-sessions`: 为跨平台 Core IPC endpoint 的路径安全性增加要求，确保 macOS 可建立真实本地 socket 连接。

## Impact

- 主要影响 `apps/desktop/src/app.tsx`、`apps/desktop/src/terminal-view.tsx`、`apps/desktop/src/preload-api.ts`、`apps/desktop/src/desktop-core-bridge.ts`、会话/终端相关 E2E 及 mock API。
- 影响 `apps/core/src/core-paths.ts`、`apps/desktop/src/core-config.ts` 与对应单元测试，以修复 macOS Unix-domain socket 路径上限。
- 在线原型与 `docs/ux/ui` 继续只作为视觉参考；新增的标签导航是用户明确要求的产品能力，优先保证真实功能与桌面可用性。
