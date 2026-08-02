## Context

用户已明确要求“复刻，完全复刻”，也明确要求 UI 必须能使用现有功能。在线原型 [cat-portal-41791527.figma.site](https://cat-portal-41791527.figma.site/) 与 `docs/ux/ui` 仅提供只读视觉结构、token 和交互外观；Electron Renderer 才是实际产品。当前桌面端已经具备 `DesktopApi`，但原型改造将它替换为硬编码 fixture，造成可见界面与真实功能脱节。

本次只验收桌面端 1440×900 和 980×640。前者由 56px Header、890px Terminal 和 550px Agent 面板组成；后者由 56px Header、500px Terminal 和 480px Agent 面板组成。原型中的演示文本、历史会话、Provider 测试成功等状态均属于复刻范围。

## Goals / Non-Goals

**Goals:**

- 让目标两个桌面视口的结构、颜色、字体度量、边框、间距、内容和状态切换与在线原型一致。
- 复刻所有原型可达状态：Session/方言/模型/权限/设置菜单，资源浮层，新建会话、提示词历史、模型与 Provider 页面及编辑弹层，Timeline 审批状态和 Audit。
- 在 Electron 中打包 Inter、Noto Sans SC 和 JetBrains Mono 字体文件，保证终端和 UI 文字宽度稳定。
- 使用 Chrome 逐页检查在线原型与本地 Renderer，并以 Playwright 布局和截图契约防止回归。

**Non-Goals:**

- 不为移动端或 390px 视口设计任何替代布局。
- 不扩展 Core、Preload、Session、Model 或 Provider 的真实 API。
- 不以原型 fixture、`docs/ux/ui` 内容或开发服务器替代真实 Electron Renderer 的会话、终端、资源、Agent、审计、模型或 Provider 状态。
- 不把 `docs/ux/ui` 的 Tailwind/shadcn 运行时依赖直接引入 Electron。

## Decisions

### 1. 在线原型约束视觉，DesktopApi 约束行为

实现以 [在线原型](https://cat-portal-41791527.figma.site/) 的 Chrome 实际状态为视觉基准，以 `docs/ux/ui` 的布局和字体为只读参考。Renderer 的会话、终端、资源、Agent、审计、模型与 Provider 状态及所有写操作必须通过 `DesktopApi`，Electron 必须优先使用 preload API。

这样可保持原型的像素级结构，同时使真实用户数据、终端输出和安全操作仍然可用。视觉测试使用 mock API 提供稳定数据，而非将固定展示数据写进组件。

### 2. 使用运行时 view model 与开发环境 mock

`App` 维护原型中的页面、下拉菜单、Dialog、Agent Tab 和输入框；会话、资源、Timeline、Audit、模型和 Provider 都从 `DesktopApi` 读取并订阅。浏览器 E2E 在 preload 缺失时使用 `createMockDesktopApi()`，它实现同一接口并提供可重复的开发数据；Electron 中不会使用该 mock 覆盖真实 API。

将 UI 状态和运行时数据分离可避免硬编码会话和审批结果，同时使测试能在 mock API 上覆盖真正的调用、订阅和错误状态。

### 3. 固定桌面几何而非响应式重排

工作区采用 Header + `minmax(0, 1fr)` Terminal + 固定 Agent 列。Agent 在 1440px 宽为 550px，在 980px 宽为 480px；Header 始终 56px。页面不出现移动端抽屉或隐藏 Agent 的断点。不能以百分比或内容尺寸改变这两个基准几何。

这与原型实际行为一致，也排除了旧实现的 356px 面板和窄屏抽屉。桌面宽度小于 980px 不在本变更验收范围内。

### 4. 终端与字体度量单独锁定

UI 字体为 `Inter, "Noto Sans SC", system-ui, sans-serif`；终端为 `"JetBrains Mono", monospace`，14px 字号、约 22.75px 行高和 20px 内容内边距。字体以本地 WOFF2 加载，xterm 同样配置 JetBrains Mono。根背景/Agent/Header 是 `#09090b`，Terminal 是 `#000`，边框为原型的中性深灰。

字体和终端 canvas 度量决定大量像素位置，依赖 Google Fonts 或沿用 Cascadia Code 都会导致文本换行和列宽漂移。

### 5. 页面和弹层按原型拆分

工作区、模型页、Provider 页由同一 Header 控制。菜单互斥，但 Resource、New Session、Prompt History、Model Edit 和 Provider Edit 遵从原型的弹层层级和位置。模型页使用表格，Provider 页使用卡片；Model Edit 和 Provider Edit 是居中的紧凑 Dialog，Provider 的“测试连接”会从默认到连接中再到测试成功。

选择该边界可直接逐项映射原型页面，也避免旧管理页因真实字段过多而改变弹层尺寸和信息层级。

### 6. 先建视觉契约，再改实现

在修改 Renderer 前，Playwright 测试应断言两套桌面视口的 Header/Terminal/Agent 精确矩形、字体声明、关键可见文本与原型交互状态，并保存可对照截图。测试先失败后再实现；Chrome 用于最终的人工像素检查。

## Risks / Trade-offs

- [真实运行时数据长度或文案不同于原型] → 锁定面板几何、字体、间距和溢出规则；E2E 使用稳定 mock 数据，Electron 以真实数据验收功能。
- [本地字体缺失造成 canvas 度量偏移] → 打包 WOFF2，等待字体就绪后再初始化/适配 xterm，并在两种基准尺寸截图验证。
- [已有 2,000 多行 `app.tsx` 和 2,700 多行样式残留规则] → 以原型组件边界重建 UI，删除或隔离旧 CSS，避免选择器串扰。
- [Chrome 与 Electron 渲染存在轻微抗锯齿差异] → 先锁定几何、字体、颜色和 DOM 层级，再用截图差异容限识别抗锯齿而非放宽布局契约。
- [在线原型操作本身只是演示] → 只复刻其交互外观；批准、接管、刷新、保存与检测仍调用真实 API。

## Migration Plan

1. 在 Chrome 记录两个桌面基准视口及所有原型页面/弹层状态，更新文档和失败测试。
2. 打包字体、建立原型 token 和固定工作区骨架，先通过几何/字体测试。
3. 将工作区、xterm、资源、Timeline/Audit、所有下拉菜单和 Dialog 接回 `DesktopApi`，再实现模型与 Provider 页面。
4. 逐一验证会话、终端输入输出、资源刷新、Agent 审批/接管、模型拉取、Provider 保存与检测，并运行 Chrome 和 Electron 对比。
5. 如需回滚，恢复 Renderer UI/CSS/视觉测试即可；Core、数据和协议未迁移。

## Open Questions

- 无。用户已确认在线原型、演示内容和完整桌面复刻均为本次范围。
