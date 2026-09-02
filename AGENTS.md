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

## GitHub Release 发布说明流程

### 原则

- 发布说明面向**最终用户**，使用简体中文；它不是 git log 的搬运，而是说明「本次发布对使用者意味着什么」。
- 范围 = 自上一发布 tag 起的用户可见变化；只写仓库中**真实发生且已合并**的变更，不描述规划或半成品。
- 自动化与人工/Agent 分工：`release.yml` 负责打包与创建 Release（`gh release create --generate-notes` 产出占位说明），发布说明的精修由发布者负责。

### 标准流程

1. **准备（发布前）**
   - 确认 develop 及合并后的 master 上 CI（`持续集成`）通过；本地执行 `pnpm verify`。
   - 同步版本号：根目录 `package.json` 与 `apps/desktop/package.json`（必要时含构建配置）改为同一新版本，提交如 `chore: 同步 vX.Y.Z 版本号`。
   - 用 `git log <上一tag>..HEAD`（排除 merge 提交）收集发布区间提交，并结合 `openspec/` 归档与 `docs/adr/` 判断破坏性变更。
2. **起草发布说明**：按下方结构与模板整理，保存为本地临时文件（如 `.tmp-release-notes-vX.Y.Z.md`，由 `.gitignore` 排除，不提交入库）。
3. **发布**：合并 develop 到 master 后，在 master 上打 tag 并推送。tag 推送触发 `release.yml`：先 `verify`，再构建 Windows/macOS 产物并创建 GitHub Release。
4. **精修说明（发布后）**：工作流成功后，用精修稿覆盖自动生成的占位说明：
   ```bash
   gh release edit vX.Y.Z --notes-file .tmp-release-notes-vX.Y.Z.md
   ```
5. **验收**：用 `gh release view vX.Y.Z` 核对正文、安装包资产（`Synapse-Term-*-Setup.exe` / `Synapse-Term-*.dmg`）与 `SHA256SUMS.txt` 均就位；预发布版本应带 `--prerelease` 标记（`release.yml` 对含 `-` 的 tag 自动处理）。

### 发布说明结构模板

```markdown
# Synapse Term vX.Y.Z

本次发布聚焦「一句话主题概述」。

## 破坏性变更

- 说明行为变化、影响范围与迁移方式（没有则删除本节）。

## 新功能

- 面向用户的一句话功能描述，必要时注明入口或用法。

## 修复

- 描述用户可感知的问题修复（说明原现象与结果）。

## 内部改进与维护

- 重构、依赖升级、文档与测试等（用户不可感知的改动并入本节，不必逐条展开）。

## 下载与校验

- Windows x64 安装包、macOS arm64 DMG 见本 Release 资产；
- 安装前可用 `SHA256SUMS.txt` 校验文件完整性。
```

### 写作约束

- 每条目为一行动宾短句，先写用户价值、后写实现细节；避免 commit 内部行话与实现术语。
- 新功能/修复条目优先标注对应的 Issue、PR 或 OpenSpec Change 链接。
- 破坏性变更必须置顶并给迁移指引；其余按「新功能 → 修复 → 维护」排序。
- 首次发布（无上一 tag）时，从仓库首个有意义的里程碑起梳理，并在说明中标注这是首个正式版本。
