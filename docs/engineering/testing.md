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
| session-runtime    | Session 生命周期、环境/启动默认值、输出事件映射、runtime 公共出口与依赖方向             |
| mcp-runtime        | MCP 工具、Sharing、审批、输入授权、脱敏、输出历史、Controller 与 embedded endpoint      |
| test-kit           | Fake TerminalBackend 和测试替身契约                                                   |
| desktop            | Electron Composition Root、IPC adapter/preload、IPC 白名单、设置/主题和 Mock API       |
| application-updates | 检查并发/超时、取消迟到事件、确认过期与 Session 变化、清理顺序、受限 IPC、真实 Ed25519 校验、发布资产与测试密钥隔离 |

### 浏览器 E2E（`pnpm test:e2e`）

| 场景          | 断言                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------- |
| workspace     | 终端工作区、多 Session、设置分类、主题/配色、Probe 回显设置和新建会话                       |
| session-tabs  | 会话标签/搜索、关闭确认、默认别名、重命名、终端内容保持和主题下的交互可读性                   |
| mcp-access    | MCP 端点配置、Token/端口、Session Sharing、Share Text、审批卡片、外部执行状态和响应式布局     |
| application-updates | 下载/取消、结束 Session 前的确认、失败入口、窄窗口与主题可读性 |

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

打包冒烟同时检查更新 preload API、当前运行版本和自动检查偏好。Windows 的 `pnpm test:installer` 检查真实 NSIS 静默安装、覆盖升级、`--force-run` 重启和卸载保留数据；通过 `-UpgradeSetupPath` 指定更高版本后才能称为跨版本升级测试。

macOS CI 用独立测试密钥构建 helper/framework，检查架构和 ad-hoc 签名，并验证 Sparkle 签名工具与 Node Ed25519 互通。当前 Windows 开发环境无法执行 Mac 验收；Gatekeeper、系统权限、A 到 B 替换与重启仍须按 [应用更新手册](app-updates.md) 记录实机结果，不能以浏览器 mock 或 CI 编译结果代替。
