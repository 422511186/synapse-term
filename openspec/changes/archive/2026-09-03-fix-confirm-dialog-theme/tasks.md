## 1. 回归测试先行

- [x] 1.1 在 `apps/desktop/e2e/session-tabs.spec.ts` 增加浅色/深色确认框可读性测试：切换主题、打开关闭终端确认框，读取标题/正文/取消按钮与面板计算颜色并断言对比度不低于 4.5:1
- [x] 1.2 运行新增 Playwright 测试并确认浅色场景在修复前失败（red）

## 2. 实现与验证

- [x] 2.1 修改 `apps/desktop/src/renderer/feedback/confirm-dialog.tsx`：面板 `bg-[#18181b]` 改为 `bg-popover`，页眉/页脚 `bg-[#09090b]` 改为 `bg-background`，并让弹窗根元素使用与表面配对的 `text-popover-foreground`
- [x] 2.2 运行 `pnpm test:e2e apps/desktop/e2e/session-tabs.spec.ts`，确认新增测试与既有会话标签场景全部通过（green）
- [x] 2.3 运行 `pnpm --filter @synapse-term/desktop typecheck` 与 `pnpm --filter @synapse-term/desktop test --run apps/desktop/src/renderer/feedback`，确认类型与组件测试无回归
