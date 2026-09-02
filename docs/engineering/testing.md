# 测试指南与验证矩阵

## 测试指南

- Vitest 覆盖单元、集成、协议与安全行为；Playwright 覆盖 Mock Renderer 与条件式 Electron 场景。
- 新增行为必须补充同目录回归测试（`*.test.ts` / `*.test.tsx`）；跨进程或用户流程变更应更新 `apps/desktop/e2e/`。
- 仓库未设固定覆盖率百分比，但 PR 至少应通过 `pnpm verify`；涉及界面流程时同时运行 `pnpm test:e2e`。

## 覆盖矩阵

### 单元/集成测试（`pnpm test`）

| 范围 | 覆盖 |
| ---- | ---- |
| domain | Session 状态转换、依赖方向、公共 API |
| terminal-service | PTY 适配、SessionActor 事件序与输出分片、SessionManager 上限、Shell 发现 |
| test-kit | FakeTerminalBackend 契约 |
| desktop | TerminalHost 会话生命周期与实时输出、IPC 通道白名单、Mock API、Session Alias/Launch/Status、设置占位页 |

### 浏览器 E2E（`pnpm test:e2e`）

| 场景 | 断言 |
| ---- | ---- |
| workspace | 终端-only 布局、无 Agent/共享/审计入口、设置占位页、新建会话 |
| session-tabs | 20 会话标签/搜索、关闭确认、默认别名与重命名 |

### 真实 Electron

- `pnpm build && pnpm start` 冒烟：本地 Shell 创建 Session、输入/实时输出、退出清理。
- `pnpm smoke:packaged-desktop <packaged-app>`：在打包应用内通过 preload 创建真实 PTY Session，验证 node-pty 与图标资源随包可用。
