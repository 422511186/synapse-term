## 1. 原型基线与视觉回归

- [x] 1.1 使用 Chrome 记录在线原型在 1440×900、980×640 的工作区、所有 Header 菜单、Dialog 和二级页的精确可见状态
- [x] 1.2 更新 `apps/desktop/e2e` 的桌面视觉契约，覆盖 Header 56px、Terminal/Agent 890/550 与 500/480、色值、字体和关键原型文案
- [x] 1.3 在现有 Renderer 上运行新增视觉契约并确认其因旧 UI 几何、品牌和字体而失败
- [x] 1.4 为会话、资源、Timeline/Audit、提示词历史、模型/Provider 页面、模型拉取和 Provider 测试连接分别添加交互回归场景

## 2. 字体、Token 与固定工作区

- [x] 2.1 将 Inter、Noto Sans SC 与 JetBrains Mono WOFF2 作为本地 Renderer 资源引入，并建立原型字体声明
- [x] 2.2 重建 `apps/desktop/src/styles.css` 的根 token、滚动条、Header、Terminal、Agent 和弹层基础样式，移除与原型冲突的旧主题布局规则
- [x] 2.3 将 `apps/desktop/src/terminal-view.tsx` 的 xterm 字体、字号、行高、内边距和色彩调整为原型基线
- [x] 2.4 重建 `apps/desktop/src/app.tsx` 的固定 56px Header、1440/980 双栏几何和黑色原型终端示例区域
- [x] 2.5 运行工作区视觉测试，确认 1440×900 和 980×640 的几何/字体契约转绿

## 3. 工作区交互复刻

- [x] 3.1 复刻 `Synapse Term` Header、会话、方言、模型、权限和设置菜单，并实现菜单互斥和示例会话切换
- [x] 3.2 复刻资源浮层、新建会话 Dialog、提示词历史 Dialog 和相应关闭/回填交互
- [x] 3.3 复刻 Agent Timeline、审批批准/拒绝状态、Audit、Composer 和发送按钮状态
- [x] 3.4 运行工作区交互测试并确认新增场景转绿

## 4. 模型与 Provider 二级页

- [x] 4.1 重建 `apps/desktop/src/model-management-page.tsx` 的模型表格、Provider 卡片和返回工作区导航
- [x] 4.2 复刻模型编辑 Dialog、远程模型拉取加载状态、模型列表和模型 ID 回填
- [x] 4.3 复刻 Provider 编辑 Dialog、连接中和测试成功状态，以及取消/保存关闭行为
- [x] 4.4 运行模型与 Provider 交互测试并确认新增场景转绿

## 5. Chrome 像素验收

- [x] 5.1 使用 Chrome 将本地工作区与在线原型在 1440×900 逐屏比对，修正几何、字体、颜色、间距和遮罩差异
- [x] 5.2 使用 Chrome 将本地工作区与在线原型在 980×640 逐屏比对，修正几何、溢出和断点差异
- [x] 5.3 使用 Chrome 逐一验收全部菜单、资源、新建会话、提示词历史、审批、Audit、模型/Provider 页面与两个编辑 Dialog
- [x] 5.4 运行相关 E2E、类型检查和桌面构建验证，并记录任何与本次 UI 无关的既有平台失败

## Verification Notes

- `pnpm exec playwright test apps/desktop/e2e/workspace.spec.ts`: 5/5 passed.
- `pnpm exec vitest run apps/desktop/src/prototype-terminal.test.ts apps/desktop/src/terminal-view.test.ts --reporter=verbose`: 2/2 passed.
- `pnpm --filter @terminal-agent/desktop typecheck` and `pnpm --filter @terminal-agent/desktop build`: passed.
- `pnpm test` still reports platform/environment failures outside this Renderer UI change: Unix-domain socket `EINVAL`, the Windows installer fixture, `node-pty` `posix_spawn`, and the ephemeral secret-store temporary-path assertion.
- `pnpm exec playwright test apps/desktop/e2e/workspace.spec.ts apps/desktop/e2e/runtime-workspace.spec.ts`: 11/11 passed after replacing stale prototype fixture assertions with runtime API contracts.
- Chrome at 1440x900 matched the online prototype's 56px Header, 890px Terminal, and 550px Agent layout; Chrome at 980x640 matched the 500px/480px desktop layout without document overflow.
- The built Electron Renderer loaded the preload `DesktopApi` successfully on macOS. Runtime Core calls remain blocked outside this UI change because the generated Unix socket path is 125 bytes and reproduces `listen EINVAL` on Darwin.

## 6. DesktopApi 功能接线（原型视觉保持不变）

- [x] 6.1 修正 Proposal、Design 和 Specs：在线原型与 `docs/ux/ui` 仅作只读视觉基准，Electron Renderer 必须保留 `DesktopApi` 功能。
- [x] 6.2 先添加失败的浏览器回归场景，证明页面使用运行时会话、xterm、资源、Agent、审计、模型和 Provider API，而不是硬编码 fixture。
- [x] 6.3 将工作区会话列表、创建、关闭、方言、xterm 输出/输入和资源监控接回 `DesktopApi`。
- [x] 6.4 将 Composer、Timeline、审批、接管、取消、提示词历史和 Audit 接回 `DesktopApi`。
- [x] 6.5 将模型/Provider 二级页、保存、远程模型发现、检测、启用、默认和删除接回 `DesktopApi`。
- [x] 6.6 在实际 Electron 与 Chrome 中重新执行视觉和运行时回归，记录通过结果与非 UI 平台失败。
