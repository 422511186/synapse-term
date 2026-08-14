# Repository Guidelines

## 产品定位与架构边界

Synapse Term 是本地优先的桌面终端：用户先在现有 Terminal Session 中准备本地 Shell、SSH、跳板机、容器或 WSL 环境，应用负责管理 PTY、Session 与回放。它不建立服务器资产、SSH 拓扑或远程凭据模型。

Renderer 只负责界面并通过受限 preload API 通信；Electron Main 通过 `terminal-host.ts` 持有 PTY、Session 与内存回放。任何入口都不得绕过 Main 的校验边界，Renderer 不得直接访问 Node API、PTY 或 Session 内部状态。

## 项目结构与模块组织

本仓库是 pnpm workspace。`apps/desktop` 包含 Electron 主进程、preload、React Renderer 与 `e2e/`。`packages/` 按职责拆分领域、终端服务与测试工具：`domain` 持有 Session/终端领域模型，`terminal-service` 持有 PTY、Session、回放与 Shell 发现，`test-kit` 提供测试替身；跨包依赖应通过各包的 `src/index.ts` 公共出口。单元测试与源码同目录，命名为 `*.test.ts` 或 `*.test.tsx`。字体等静态资源位于 `apps/desktop/src/renderer/assets/`；架构、安全和运行说明在 `docs/`；规格变更及归档位于 `openspec/`。

## 构建、测试与开发命令

- 切换 Node.js 前先运行 `nvm ls` 检查本机版本，优先 `nvm use` 已安装且满足 `>=24.12.0 <25` 的版本；缺失时再执行 `nvm install 24.12.0`。
- `corepack enable && pnpm install --frozen-lockfile`：启用 Corepack，并使用锁定的 pnpm 10.28.1 安装依赖。
- `pnpm dev`：启动使用 Mock API 的 Renderer，适合界面开发，不包含真实 Core 或 PTY。
- `pnpm build && pnpm start`：构建并启动真实 Electron 桌面端。
- `pnpm verify`：依次执行 Prettier 检查、ESLint、TypeScript 类型检查和 Vitest。
- `pnpm test:e2e`：运行 Playwright 浏览器端到端测试。
- `pnpm test:coverage`：生成 Vitest 覆盖率报告。

## 编码风格与命名约定

统一使用 UTF-8、LF、两个空格缩进并保留文件末尾换行。Prettier 配置为单引号、尾随逗号、100 字符行宽；提交前运行 `pnpm format` 或 `pnpm format:check`。ESLint 要求使用一致的类型导入，并禁止显式 `any`。文件通常采用 kebab-case，如 `agent-runtime.ts`；类型和 React 组件使用 PascalCase，变量与函数使用 camelCase。

## 测试指南

Vitest 覆盖单元、集成、协议与安全行为；Playwright 覆盖 Mock Renderer 和条件式 Electron 场景。新增行为必须补充同目录回归测试，跨进程或用户流程变更应更新 `apps/desktop/e2e/`。仓库未设固定覆盖率百分比，但 PR 至少应通过 `pnpm verify`；涉及界面流程时同时运行 `pnpm test:e2e`。

## Git 提交与 PR 规范

- **Commit**：使用简洁中文动宾短句，统一采用 `fix:`、`feat:`、`docs:`、`chore:` 等前缀；每个提交只解决一个问题，避免混杂无关改动。
- **PR**：说明**背景、变更内容、影响/风险、验证方式**，并关联对应 Issue 或 OpenSpec Change；涉及 UI 改动时附前后截图。
- **合并前**：确认 CI、代码格式、类型检查和测试全部通过。
- **提交内容**：禁止提交 `dist/`、`release/`、测试报告、用户数据、凭据、真实主机/IP 等环境敏感信息。
- **提交历史**：保持清晰、可追溯，避免无意义提交和与当前问题无关的改动。
