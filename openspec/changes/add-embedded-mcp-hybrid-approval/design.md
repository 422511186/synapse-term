# Design: Add Embedded MCP Hybrid Approval

## Context

本分支（`feat/trim-terminal-slim`）是纯终端架构：`packages/` 仅含 domain / terminal-service / test-kit，`SessionActor` 只暴露 `writeUser` / `resize` / `terminate` / `waitForExit` / 事件订阅。develop 分支已有完整实现可参考：`apps/desktop/src/mcp/*`、ExternalToolPipeline、CommandExecutor／OutputJournal、PolicyEngine／SecretRedactor，以及三档审批模式与 mcp-access 规格。

裁剪时删除的外部接入设施与本变更的关系、混合审批对 develop ADR-0023 的部分推翻，已分别记录于 ADR-0014 与 ADR-0015；领域词汇见根目录 `CONTEXT.md`。

现有约束：
- Renderer 不得直接访问 Node API / PTY / Session 内部状态，一切经受限 preload API（AGENTS.md 架构边界）
- 单用户本地产品边界（ADR-0013）：无账户、无集中审计
- 设置工作区当前为只读占位（specs/settings-workspace），本变更为其首次承载真实配置区

## Goals / Non-Goals

**Goals:**

- 外部客户端经 MCP 安全操作"已共享"的会话：执行、观察、等待、中断、状态探测
- 三档审批模式＋高危同步阻塞审批卡片（60 秒超时即拒）
- 执行期间本地可见标记（标签徽标＋面板条幅），本地输入永不锁定
- 全链路稳定错误码与输出脱敏

**Non-Goals:**

- 审计日志持久化与查询界面
- 文件读写工具（LocalFileService 不回归）
- 会话枚举/发现能力（对外永远不可枚举）
- MCP 客户端方向（Synapse Term 连接外部 MCP Server）
- 远程/非回环监听、多用户、策略分发

## Decisions

### D1. 引擎采取"搬回旧引擎做减法"

从 develop 移植 CommandExecutor（完成检测）、OutputJournal（输出缓冲）、ExternalToolPipeline（策略/脱敏管线）、PolicyEngine 与 CommandRisk 分类，适配到裁剪后的 SessionActor。不重写最小版本——执行收敛判定是无人值守循环的安全命门，develop 已踩平其中边界（PR #3 曾修复多项 Critical）。
_替代方案被否_：在 `writeUser` 上自研最小 execute——重造轮子且丢失事务/租约语义。

### D2. 模块归属沿用 develop 布局

MCP 控制器、内嵌 HTTP 端点、设置持久化放 `apps/desktop/src/main/mcp/`（Main 进程）；Renderer 经 preload 受限 API 读写设置与审批裁决。工具注册与 schema 定义独立成模块便于测试。执行原语进 `packages/terminal-service/src/session/`（与 SessionActor 同目录），风险分类等领域类型进 `packages/domain/`。

### D3. 三档策略矩阵在管线入口裁决

裁决矩阵（ADR-0015）：read_only 只放行观察类；managed 放行低危、其余弹卡；full 全放行但保留脱敏。裁决发生在 ExternalToolPipeline 入口，按调用类别映射：

| 工具 | 类别 |
|---|---|
| synapse_status / observe / wait | 观察类 |
| synapse_execute | 按命令内容经 PolicyEngine 分类 |
| synapse_interrupt | 低危控制 |

未分类命令在 managed 下弹卡而非死拒：有人在场时，人的判断优于硬编码拒绝；卡片通道使这成为安全选择。
_替代方案被否_：未分类一律拒绝（develop 行为）——外部调用方无法自救，用户体验为"莫名失败"。

### D4. 审批卡片走 Main 队列 + Renderer 模态

Main 持 FIFO 审批队列，每张卡片从展示时刻起算 60 秒超时（超时→`APPROVAL_TIMEOUT`）；Renderer 收到 IPC 事件渲染模态层并触发窗口抢注意力；用户裁决（允许一次／会话内放行该命令／拒绝）经 preload 回传 Main。会话内放行记忆存于该会话的管线缓存（精确全文匹配），随会话关闭销毁，不落盘。
排队中的调用其 HTTP 请求保持挂起；队列深度不做上限（本机单用户场景）。

### D5. 共享模型与共享文本

两段式：设置页复制连接串（回环地址+token）建立通道 → 终端标签"共享"动作生成共享文本写入剪贴板。共享文本为预置提示词块（含 sessionId、可用工具清单、连接前提），另留裸 ID 复制次级按钮。取消共享（设置页列表或标签菜单）后该会话所有后续调用返回 `SESSION_EXPIRED`；PTY 退出自动失效并清理管线缓存。

### D6. 执行标记为纯信息展示

`synapse_execute` 开启事务至收敛/打断期间：会话标签显示旋转徽标（悬停展示命令全文与来源）、终端面板顶部显示条幅。本地输入永不锁——标记解决"知道发生了什么"，控制权从未离开本地（直接敲 Ctrl+C 即逃生通道）。瞬时调用（status/observe）不打标。

### D7. 错误码契约

所有工具错误以稳定码开头：`SESSION_EXPIRED`（不存在/未共享/已取消/PTY 退出）、`SESSION_NOT_READY`（Shell 未就绪，附重试指引）、`SESSION_BUSY`（租约不可用）、`TRANSACTION_NOT_FOUND`、`POLICY_DENIED`、`APPROVAL_TIMEOUT`、`APPROVAL_DENIED`。错误文本含错误码、原因、下一步指引；不泄露其他会话存在性。`synapse_status` 对失效会话返回 `expired` 状态而非抛错。

### D8. 设置持久化与安全默认

`userData/mcp/settings.json`：enabled（默认 false）、approvalMode、token。sanitize 白名单校验，损坏即整体回退默认（read_only + disabled）。token 可再生成/吊销，吊销后立即拒绝所有未完成调用。HTTP 端点仅回环、Bearer 认证、关闭开关即停止。

## Risks / Trade-offs

- [移植面大、develop 依赖链深] → 按 D2 切分模块边界逐块移植；每块带同目录回归测试先行（TDD），以 `pnpm verify` 把关
- [同步阻塞卡片占用 HTTP 连接] → 本机回环场景连接成本低；60 秒上限保证最终有响应；agent loop 侧表现为一次慢调用而非悬挂
- [会话内放行被滥用（粘贴恶意命令骗一次放行后反复执行）] → 精确全文匹配使命令文本成为显式同意对象；记忆随会话消失；无跨会话/永久形态
- [full 模式风险] → 显式选择＋高风险提示文案＋损坏回退 read_only；单用户本机边界下用户主权优先（ADR-0013）
- [脱敏误伤正常输出] → 沿用 develop 已验证的 SecretRedactor 规则集；规则问题作为缺陷修复而非绕过脱敏
- [裁剪分支与 develop 后续合并冲突] → ADR-0014 已记录分歧点；synapse_* 命名差异将合并时的语义冲突限制在工具注册层

## Migration Plan

纯新增能力，无数据迁移。设置文件为新增路径，首启默认关闭。回滚＝移除 Main 中 MCP 模块装配点，终端核心不受影响。

## Open Questions

无——决策树已在 grilling 会话全部闭合（11 项决定，见 ADR-0014/0015 与本文 D1–D8）。
