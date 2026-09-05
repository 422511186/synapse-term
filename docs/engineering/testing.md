# 测试指南与验证矩阵

## 测试指南

- Vitest 覆盖单元、集成、协议、并发和安全行为；Playwright 覆盖 Mock Renderer 与条件式 Electron 场景。
- 新增行为必须补充同目录回归测试（`*.test.ts` / `*.test.tsx`）；跨进程或用户流程变更应更新 `apps/desktop/e2e/`。
- 仓库未设固定覆盖率百分比，但 PR 至少应通过 `pnpm verify`；涉及界面流程时同时运行 `pnpm test:e2e`。
- 真实 Electron MCP 验证默认跳过，设置 `SYNAPSE_TERM_ELECTRON_E2E=1` 后再运行对应场景。

## 覆盖矩阵

### 单元/集成测试（`pnpm test`）

| 范围               | 覆盖                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------ |
| domain             | Session 状态转换、外部调用者、命令协议、事务与依赖方向                               |
| terminal-service   | PTY 适配、SessionActor/Manager、Shell 发现、完成 Probe、结构化/交互事务和输出边界      |
| test-kit           | Fake TerminalBackend 和测试替身契约                                                   |
| desktop            | TerminalHost 生命周期、实时输出、IPC 白名单、设置/主题、Mock API、MCP 控制器与端点管线 |

### 浏览器 E2E（`pnpm test:e2e`）

| 场景          | 断言                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------- |
| workspace     | 终端工作区、多 Session、设置分类、主题/配色、Probe 回显设置和新建会话                       |
| session-tabs  | 会话标签/搜索、关闭确认、默认别名、重命名、终端内容保持和主题下的交互可读性                   |
| mcp-access    | MCP 端点配置、Token/端口、Session Sharing、Share Text、审批卡片、外部执行状态和响应式布局     |

### 真实 Electron

`apps/desktop/e2e/electron-mcp-access.spec.ts` 是可选的真实端到端场景，覆盖：

- Electron Main 启动内嵌 MCP Server，并验证回环地址、端口和 Bearer Token 鉴权；
- 八个 `synapse_*` 工具的发现、状态、输出游标和执行上下文校验；
- 结构化命令、交互事务、有限输入授权、审批超时/拒绝、Token 吊销和输出脱敏；
- 外部执行期间本地终端仍可见且保持可交互。

运行方式：

```bash
SYNAPSE_TERM_ELECTRON_E2E=1 pnpm test:e2e apps/desktop/e2e/electron-mcp-access.spec.ts
```

真实 PTY 打包冒烟仍使用：

```bash
pnpm build
pnpm smoke:packaged-desktop <packaged-app>
```
