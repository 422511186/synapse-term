## 1. 设置菜单顺序

- [x] 1.1 在 `apps/desktop/src/renderer/app.tsx` 全局设置菜单中将“服务商配置”按钮移到“模型配置”按钮上方，图标与点击行为保持不变

## 2. 验证

- [x] 2.1 运行 `openspec validate settings-menu-order --strict` 并产出验证记录
- [x] 2.2 运行相关前端测试（app/renderer 相关专项）并全部通过
- [x] 2.3 运行 `pnpm verify` 确认无回归
