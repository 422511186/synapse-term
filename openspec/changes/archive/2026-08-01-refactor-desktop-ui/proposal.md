## Why

当前 Electron Renderer 的信息架构、品牌、终端字体、配色、面板宽度和二级页面均与目标设计明显不同。用户要求将桌面端逐像素复刻为在线原型 [cat-portal-41791527.figma.site](https://cat-portal-41791527.figma.site/)，同时保留既有桌面端的真实会话、终端、资源、Agent、审计、模型和 Provider 功能。此前实现只复刻了演示状态，断开了 `DesktopApi`，因此不能作为可用产品。

## What Changes

- **BREAKING (UI)** 将 Renderer 的桌面视觉与交互改为在线原型的完整复刻；在线原型和 `docs/ux/ui` 仅作为只读视觉、布局和文案参考，不能成为运行时或验收目标。
- 固定桌面布局：顶部栏为 56px；1440×900 时终端和 Agent 面板分别为 890px/550px；980×640 时分别为 500px/480px。移动端抽屉、窄屏重排和 390px 验收不在本变更范围内。
- 复刻原型的黑灰视觉语言、`Synapse Term` 品牌、Inter/Noto Sans SC UI 字体和 JetBrains Mono 终端字体；会话名、终端内容、Timeline、Audit、资源、模型和 Provider 列表来自实际运行时。
- 保留并接入 `DesktopApi`：会话创建/关闭/方言，xterm 输入输出，资源获取和刷新，Agent 提交/取消/审批/接管/历史，审计，以及模型和 Provider 的列表、保存、发现、检测、启用与删除。
- 浏览器开发环境可使用 `createMockDesktopApi()` 作为可重复的测试替身；Electron Renderer 必须优先使用 preload 暴露的真实 API，任何 fixture 都不得覆盖它。
- 打包本地字体资源，避免在线字体加载导致 Electron 中字体度量偏离原型。

## Capabilities

### New Capabilities
- `prototype-fidelity`: 定义以在线原型为唯一视觉与交互基准的桌面逐像素复刻、字体资源和截图验收。
- `prototype-session-resources`: 定义原型会话、资源监控、新建会话与提示词历史的演示状态和交互路径。

### Modified Capabilities
- `desktop-terminal`: 将工作区改为固定的原型终端/Agent 双栏布局，同时以真实会话、xterm 和 Agent 状态驱动内容。
- `desktop-model-management`: 将模型与 Provider 页面及编辑弹层改为原型视觉，并接入真实列表、保存、发现与检测。
- `terminal-safety-audit`: 将审批与审计改为原型视觉表现，同时显示真实 API 事件并执行真实安全操作。

## Impact

- 主要影响 `apps/desktop/src/app.tsx`、`apps/desktop/src/model-management-page.tsx`、`apps/desktop/src/styles.css`、`apps/desktop/src/terminal-view.tsx` 和桌面端视觉 E2E 测试。
- 参照源固定为 [在线原型](https://cat-portal-41791527.figma.site/) 和 `docs/ux/ui` 的只读视觉资产；实际运行与验收目标是 Electron Renderer，而不是 `docs/ux/ui` 或其 Vite 服务。
- 需要将本地字体纳入 Renderer 资源，并更新 Playwright 桌面截图/运行时交互契约；不修改 Core 协议、Preload API、数据存储或移动端体验。
