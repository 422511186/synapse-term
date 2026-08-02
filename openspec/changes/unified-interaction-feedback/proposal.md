## Why

桌面端大量操作（检测/启用模型、MCP/ACP 开关、Agent 运行、审批等）缺少统一的进行中、成功与失败反馈：有的只有按钮变灰，有的成功无提示，有的失败才弹阻塞框，用户无法判断操作是否生效、Agent 是否卡死。同时按钮普遍缺少防连点保护，短时间重复点击可能发起重复请求。

## What Changes

- 引入统一的交互反馈原语：toast 轻提示系统、异步操作按钮（进行中/成功/失败三态）、确认对话框、运行状态常驻指示器。
- 所有异步操作统一防抖/防连点：首次点击立即生效，请求未 settle 前忽略后续点击；快速状态翻转操作同样有 in-flight 保护。
- 模型配置页与编辑弹窗：检测模型补成功态与耗时展示；启用/停用改为乐观更新并在失败时回滚；删除操作增加确认；新建模型可直接检测。
- Agent 面板：新增运行状态条（当前模型/已运行时长/取消任务）、"思考中…"占位气泡、外部 Agent 首次启动的阶段提示、审批/拒绝/取消按钮的 pending 态。
- MCP 与 ACP 设置页开关改为异步三态（启动中/停止中/运行中/未运行），不再只是变灰。
- 错误反馈分级：配置类操作错误走 toast；Agent 运行时错误保留带"取消当前任务"入口的错误对话框。

## Capabilities

### New Capabilities
- `interaction-feedback`: 统一的桌面端交互反馈机制，覆盖 toast 提示、异步按钮三态、防连点/防抖、确认对话框与运行状态指示器。

### Modified Capabilities
- `desktop-model-management`: 模型检测成功态与耗时、启用/停用乐观更新与失败回滚、删除确认、新建模型可检测。
- `desktop-terminal`: Agent 运行状态条、"思考中…"占位、外部 Agent 启动阶段提示、审批/取消按钮 pending 与防连点。

## Impact

- `apps/desktop/src/renderer`：`app.tsx`、设置页（model/provider/mcp/acp）、模型编辑弹窗、Agent 面板（timeline、tool card、审批卡片）与新建会话弹窗。
- 可能新增共享组件（ToastProvider、PendingButton、ConfirmDialog）与 `useAsyncAction` 类原语，位于 renderer 或 `packages/ui-platform`。
- 测试：新增组件测试与 Playwright 场景覆盖三态、防连点与运行指示器。
- 无 IPC 契约、协议或后端行为变更，纯 UI 交互层改动。
