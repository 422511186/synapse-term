# Repository Guidelines

## 必读上下文（改动前）

任何代码、规格、测试或文档改动前，先读 `CONTEXT.md`（领域统一语言）与 `docs/adr/*.md`（生效中的架构决策），不得只凭文件名或记忆推断。若任务涉及 OpenSpec Change，以已批准的 proposal/design/specs/tasks 为准。发现 `CONTEXT.md`、ADR、OpenSpec 或代码互相矛盾时，先向用户说明冲突和影响，不要默默选边。

## 决策硬边界（不可逾越）

- Renderer 只能通过受限 preload API 访问能力，不得直接访问 Node API、PTY 或 Session 内部状态。
- 跨包依赖必须经过各包公共出口；领域模型不得反向依赖终端服务、Electron 或 UI。
- Session 是传输无关的本地 PTY 会话。进入 SSH、跳板机、容器或 WSL 后仍是一个 Session，不引入主机资产、凭据库或拓扑恢复模型。
- 应用保持单用户本地边界：不持久化 Session、凭据或集中审计日志；UI 重开只是重新订阅实时输出。
- 外部客户端只能操作用户已显式共享的 Session。共享不是自动枚举、远程端点或永久授权。
- MCP 审批遵循三档模式：观察类可自动放行，高危调用在 `managed` 下进入审批卡片，`full` 放行执行权但不绕过输出脱敏；审批超时视为拒绝。

## 文档路由（渐进式加载）

按任务类型加载对应文档，其余不读：

| 任务类型                   | 加载文档                            |
| -------------------------- | ----------------------------------- |
| 领域术语、命名、IPC 文案   | `CONTEXT.md`                        |
| 架构设计、仓库布局         | `docs/architecture/architecture.md` |
| 安全边界、威胁模型         | `docs/security/security.md`         |
| 构建、开发、调试、故障处理 | `docs/engineering/runbook.md`       |
| 编码风格、Git/PR 规范      | `docs/engineering/conventions.md`   |
| 测试指南、验证矩阵         | `docs/engineering/testing.md`       |
| GitHub Release 发布说明    | `docs/engineering/release.md`       |
| 文档总览与导航             | `docs/README.md`                    |

## 术语执行

优先使用 `CONTEXT.md` 中的规范词条（**Session**、**Sharing**、**Share Text**、**内嵌 MCP Server**、**外部客户端**、**审批模式**、**审批卡片**、**会话内放行**、**风险分类**），不用其标注的 `_Avoid_` 近义词。出现新的稳定领域概念时，在同一变更中更新 `CONTEXT.md`（只记术语与边界语义）；难以回退、缺少背景会令人困惑的真实取舍，新增编号 ADR 并同步检查受影响的实现说明。
