## 1. 交互反馈基建

- [x] 1.1 以 TDD 方式在 `apps/desktop/src/renderer/feedback/` 实现 `ToastProvider` 与 `useToast`（成功 3 秒自动消失、错误手动关闭、最多 3 条、同类合并、`aria-live`），并编写组件测试
- [x] 1.2 实现 `useAsyncAction` hook（leading-edge 防连点、in-flight 期间忽略重复调用、成功/错误 toast 回调），并编写单元测试覆盖快速连点只触发一次
- [x] 1.3 实现 `PendingButton` 组件（待命/进行中/成功三态、spinner、`aria-busy`、禁用与防连点），并编写组件测试
- [x] 1.4 实现 `ConfirmDialog` 组件（确认/取消、确认按钮 pending 与防连点），并编写组件测试
- [x] 1.5 在 `app.tsx` 根节点挂载 `ToastProvider`，并验证弹窗/二级页中的 toast 均可正常渲染

## 2. 模型与 Provider 配置页

- [x] 2.1 以 TDD 方式改造模型列表启用/停用：乐观更新徽标 + 成功 toast，`models.setEnabled()` 失败时回滚 + 错误 toast，in-flight 期间防连点
- [x] 2.2 改造模型列表"检测"：`PendingButton` 三态 + 成功 toast 含耗时，失败 toast 展示分类原因
- [x] 2.3 模型列表"删除"接入 `ConfirmDialog`，确认后显示"删除中…"并防连点，完成后 toast
- [x] 2.4 模型编辑弹窗补检测成功态（"检测通过" + 耗时），并将"检测模型"开放给新建模型（先保存草稿再 `models.test()`，失败保留弹窗内容）
- [x] 2.5 模型编辑弹窗保存/拉取/测试统一走 `useAsyncAction`，消除散落的 `testing`/`saving`/`fetching` 状态
- [x] 2.6 Provider 列表删除接入 `ConfirmDialog` 与 pending 态；Provider 弹窗保存/测试连接统一走 `useAsyncAction`，测试连接文案说明会先保存草稿

## 3. Agent 面板运行反馈

- [x] 3.1 以 TDD 方式实现 Agent 运行状态条：由 `activeTurn`（含 `startingTurn`、内置与 ACP activeTurn）派生，展示当前模型、已运行时长（秒级 interval，仅在运行期运行）与取消任务入口
- [x] 3.2 实现"思考中…"占位：`activeTurn` 为真且自用户消息后无新 timeline 事件时显示，第一条事件到达自动移除
- [x] 3.3 实现 ACP 首次启动阶段提示："正在启动外部 Agent（opencode）…"在 `startingTurn && driver === 'acp'` 期间显示，握手就绪事件到达后移除
- [x] 3.4 审批/拒绝/取消任务按钮加 pending 态（"批准中…/拒绝中…/取消中…"）与防连点，覆盖 `approve`、`takeOver`、`cancelTurn`、`interruptCommand`
- [x] 3.5 发送按钮补 spinner 并确认 `startingTurn` 空窗期防连点；运行状态条与取消任务按钮在任务结束时正确复位

## 4. MCP 与 ACP 设置页

- [x] 4.1 MCP 设置页开关与 token 操作改 `useAsyncAction`：启用显示"正在启动…"、停用显示"正在停止…"，状态行落定到"运行中/未运行"；吊销接入 `ConfirmDialog`
- [x] 4.2 ACP 设置页开关与审批模式改 `useAsyncAction`：关闭时显示"正在停止…"直到子进程终止；所有控件防连点

## 5. 收尾与验证

- [x] 5.1 全局排查 `window.confirm`、`busy`/`pendingId`/`testing`/`saving` 等散落实现，统一迁移到 `feedback` 基建
- [x] 5.2 运行全部单元/组件测试并修复回归
- [x] 5.3 补充 Playwright 场景：检测模型三态与防连点、模型启用乐观更新回滚、Agent 运行状态条与思考占位、MCP/ACP 开关状态流转
- [x] 5.4 运行 `openspec validate` 与验证矩阵，确认无 IPC/协议变更并产出验证记录
