# Repository Guidelines

## Agent 运行必读上下文

任何代码、规格、测试或文档改动前，Agent 必须完整阅读以下上下文，不得只凭文件名、历史记忆或本摘要推断其内容：

1. `CONTEXT.md`：领域统一语言。命名 API、类型、事件、IPC 通道、UI 文案和测试描述时，必须使用其中的规范术语。
2. `docs/adr/*.md`：架构决策记录。所有现存决策对当前工作生效，除非用户明确要求推翻并同步更新 ADR。

如果任务涉及 OpenSpec Change，还必须在实现前阅读该 Change 的 proposal、design、specs 和 tasks，并以已批准的变更为准。发现 `CONTEXT.md`、ADR、OpenSpec 或代码互相矛盾时，先向用户说明冲突和影响，不要默默选择一种解释。

### 决策硬边界

- Renderer 只能通过受限 preload API 访问能力，不得直接访问 Node API、PTY 或 Session 内部状态。
- 跨包依赖必须经过各包公共出口；领域模型不得反向依赖终端服务、Electron 或 UI。
- Session 是传输无关的本地 PTY 会话。进入 SSH、跳板机、容器或 WSL 后仍是一个 Session，不引入主机资产、凭据库或拓扑恢复模型。
- 应用保持单用户本地边界：不持久化 Session、凭据或集中审计日志；UI 重开只是重新订阅实时输出。
- 外部客户端只能操作用户已显式共享的 Session。共享不是自动枚举、远程端点或永久授权。
- MCP 审批遵循三档模式：观察类可自动放行，高危调用在 `managed` 下进入审批卡片，`full` 放行执行权但不绕过输出脱敏；审批超时视为拒绝。

### 术语执行规则

优先使用 `CONTEXT.md` 中的 **Session**、**Sharing**、**Share Text**、**内嵌 MCP Server**、**外部客户端**、**外部调用**、**审批模式**、**审批卡片**、**会话内放行** 和 **风险分类**。不要在代码、文案或文档中改用这些词条标注的 `_Avoid_` 近义词。

当讨论中出现新的稳定领域概念时，在同一变更中更新 `CONTEXT.md`；该文件只记录术语和边界语义，不承载实现细节。若某个决定难以回退、缺少背景会令人困惑，并且来自真实权衡，则新增编号 ADR，并同步检查受影响的实现说明。

## 产品定位与架构边界

Synapse Term 是本地优先的桌面终端：用户先在现有 Terminal Session 中准备本地 Shell、SSH、跳板机、容器或 WSL 环境，应用负责管理 PTY、Session 与实时输出。它不建立服务器资产、SSH 拓扑或远程凭据模型。

Renderer 只负责界面并通过受限 preload API 通信；Electron Main 通过 `terminal-host.ts` 持有 PTY 与 Session。任何入口都不得绕过 Main 的校验边界，Renderer 不得直接访问 Node API、PTY 或 Session 内部状态。

## 项目结构与模块组织

本仓库是 pnpm workspace。`apps/desktop` 包含 Electron 主进程、preload、React Renderer 与 `e2e/`。`packages/` 按职责拆分领域、终端服务与测试工具：`domain` 持有 Session/终端领域模型，`terminal-service` 持有 PTY、Session、实时输出与 Shell 发现，`test-kit` 提供测试替身；跨包依赖应通过各包的 `src/index.ts` 公共出口。单元测试与源码同目录，命名为 `*.test.ts` 或 `*.test.tsx`。字体等静态资源位于 `apps/desktop/src/renderer/assets/`；架构、安全和运行说明在 `docs/`；规格变更及归档位于 `openspec/`。

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
