# 测试指南与验证矩阵

## 基本要求

- Vitest 覆盖单元、集成、协议、并发和安全行为；Playwright 覆盖 Mock Renderer 与条件式 Electron 场景。
- 新增行为应补充同目录回归测试（`*.test.ts` / `*.test.tsx`）；跨进程或用户流程变更应更新 `apps/desktop/e2e/`。
- 仓库未设固定覆盖率百分比，但 PR 至少应通过 `pnpm verify`；涉及界面流程时同时运行 `pnpm test:e2e`。
- 真实 Electron MCP 验证默认跳过，设置 `SYNAPSE_TERM_ELECTRON_E2E=1` 后运行对应场景。

## 单元与集成测试

运行：

```bash
pnpm test
```

| 范围 | 主要覆盖 |
| --- | --- |
| domain | Session 状态、外部调用者、命令协议、事务与依赖方向 |
| terminal-service | PTY、SessionActor/Manager、Shell 发现、Probe、结构化/交互事务和输出边界 |
| session-runtime | Session 生命周期、环境/启动默认值、输出事件映射和公共出口 |
| mcp-runtime | MCP 工具、Sharing、审批、输入授权、脱敏、输出历史和内嵌端点 |
| test-kit | Fake TerminalBackend 和测试替身契约 |
| desktop | Composition Root、IPC adapter/preload、白名单、设置、主题和 Mock API |
| application-updates | 检查并发、确认过期、Session 清理、受限 IPC、Ed25519 校验和发布资产 |

## 浏览器 E2E

运行：

```bash
pnpm test:e2e
```

重点场景包括工作区、多 Session、设置和主题、Session 标签、Sharing、Share Text、审批卡片、外部执行状态、更新界面和窄窗口可读性。

## 真实 Electron MCP

```bash
SYNAPSE_TERM_ELECTRON_E2E=1 pnpm test:e2e apps/desktop/e2e/electron-mcp-access.spec.ts
```

该场景验证：

- 内嵌 MCP Server 的回环地址、端口和 Bearer Token 鉴权；
- 八个 `synapse_*` 工具、输出游标和执行上下文校验；
- 结构化命令、交互事务、有限输入授权、审批超时/拒绝、Token 吊销和输出脱敏；
- 外部执行期间本地终端保持可见和可交互。

## 打包冒烟

```bash
pnpm build
pnpm smoke:packaged-desktop <packaged-app>
```

打包冒烟检查真实 PTY、更新 preload API、运行版本和自动检查偏好。Windows 安装器测试使用 `pnpm test:installer`；跨版本升级必须传入更高版本的 `-UpgradeSetupPath`，同版本覆盖不能称为跨版本升级。

macOS CI 使用独立测试密钥构建 helper/framework，检查架构、ad-hoc 签名和 Sparkle 签名工具互操作。浏览器 E2E 或 CI 编译不能替代 Gatekeeper、系统权限和真实 A 到 B 更新验收；验收清单见[发布与更新验收](../maintainers/release-validation.md)。
