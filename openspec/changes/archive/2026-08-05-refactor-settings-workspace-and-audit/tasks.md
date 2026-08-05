## 1. 审计领域投影与隐私边界

- [x] 1.1 在 `packages/infrastructure/src/audit` 和 `packages/application/src/router/handlers` 增加聚合、结果归一化、观察噪声和 legacy 事件降级的失败测试，覆盖 `task:<taskId>`、`transaction:<transactionId>` 和 `event:<eventId>` 三类 trace key。
- [x] 1.2 在审计 Repository 增加按时间范围、Session、Task 和有界游标读取事件的查询能力，并为默认 7 天窗口和查询索引补充测试，避免 Renderer 使用无界 `listAuditEvents()`。
- [x] 1.3 扩展 `AuditService.recordCommand()` 的安全写入投影，复用 `SecretRedactor` 保存脱敏 `commandPreview`/路径摘要，同时保留 hash、风险、授权、退出码和原因；增加秘密、Protected Input、脱敏失败和旧记录兼容测试。
- [x] 1.4 实现结构化 `AuditTraceView`、`AuditTraceDetailView` 及事件 DTO，把事件分类为命令、审批、文件、会话、配置、外部调用或观察，并将终态统一为 `in_progress`、`success`、`failure`、`rejected`、`interrupted` 或 `information`。
- [x] 1.5 更新 `audit-handler`，按已有 `taskId`/`transactionId` 聚合事件、默认隐藏成功观察、应用全部筛选条件并返回 `items/nextCursor`；详情按时间正序返回稳定字段，不透传原始 payload。
- [x] 1.6 更新应用层审计路由契约，增加按 trace key 获取详情和读取保留策略的只读请求，保留 `audit.cleanup` 的过期清理语义；补充聚合、筛选、游标、结果归一化和失败观察可见性测试。

## 2. Core、协议与桌面桥接

- [x] 2.1 先更新 `packages/protocol` 的审计 schema、方法类型和响应类型，覆盖列表查询、详情查询、保留策略和 cleanup 的请求/响应边界，并补充 schema/type-contract 测试。
- [x] 2.2 同步 Core request router、`apps/desktop/src/main/core-supervisor.ts` 和 `apps/desktop/src/main/desktop-core-bridge.ts` 的审计通道映射，确保参数白名单、错误传播和游标响应一致。
- [x] 2.3 更新 `apps/desktop/src/preload/preload-api.ts`、preload 暴露对象和 `apps/desktop/src/renderer/mock-api.ts`，只暴露稳定审计 DTO；补充 Electron bridge、preload 安全和 mock 数据测试。
- [x] 2.4 更新现有审计调用方和类型引用（包括 Agent runtime audit），保持旧事件能够以兼容降级形式显示，并确保正常 App 退出仍调用 `requestExit('terminate_all')`。

## 3. Settings Workspace 容器与导航

- [x] 3.1 为 `SettingsWorkspace` 定义主题、分组和默认 Provider 入口模型，先编写导航渲染、主题切换、返回路径和状态保持测试。
- [x] 3.2 在 Renderer 新增设置工作区容器，将“配置 → 服务商配置、模型配置”“外部接入 → MCP 服务、ACP 集成”“安全与诊断 → 审计日志”作为左侧导航；一级分组标题可点击进入各组默认主题，并用明显层级和更深缩进区分二级主题。
- [x] 3.3 重构 `apps/desktop/src/renderer/app.tsx` 的 `currentView` 和 Header 设置按钮，使点击设置直接进入 Settings Workspace、默认选中 Provider，并保留返回前活动 Session、Agent Task、时间线和 Composer 状态。
- [x] 3.4 将现有 Provider、Model、MCP、ACP 和 Audit 视图接入右侧主题区域；主题切换只替换内容，不合并配置职责，也不因切换主题触发无关配置写入。
- [x] 3.5 移除设置下拉菜单中的“清空当前 Agent 会话”和“退出 Core”菜单项、图标、确认入口及 Renderer 直接调用；保留 Agent Composer 的 `/clear` slash command 和 Electron `before-quit` 的 Core 终止链路。
- [x] 3.6 更新设置工作区和 Header 的可访问名称、焦点顺序、响应式布局及返回操作，确保左侧导航在窄窗口可用且不遮挡既有 Header 固定操作。

## 4. 审计设置主题交互

- [x] 4.1 先为新的 Audit Settings 组件编写默认状态、筛选组合、关键词范围、结果标签、成功观察隐藏和错误状态测试。
- [x] 4.2 将 `apps/desktop/src/renderer/settings/audit-settings.tsx` 重构为聚合列表：默认全部 Session/最近 7 天/最新优先，支持时间、Session、发起者、类别、结果、风险、脱敏关键词和“包含观察事件”筛选。
- [x] 4.3 实现每页 25 条的游标表格分页、手动刷新和 5 秒有界轮询；支持上一页/下一页，轮询必须保留当前查询、搜索和选中 trace，离开审计主题或返回工作区时清理定时器。
- [x] 4.4 实现 Audit Trace 表格和独立详情弹窗，按时间正序展示原始事件类型、主体、策略/审批、风险、退出码、原因、脱敏命令/路径摘要、hash 和稳定关联 ID；详情加载失败不得清空列表。
- [x] 4.5 将保留策略和清理入口收进独立弹窗，展示结构化审计 30 天和原始终端日志 24 小时（以运行时策略为准），实现带策略说明和防重复提交的过期数据清理确认，并显示 raw logs/audit events 清理数量。
- [x] 4.6 明确移除全量清空、按筛选删除未过期记录、任意保留期编辑和第一版导出控件；审计 UI 不得显示 Protected Input、完整终端输出、终端录像或未脱敏秘密。

## 5. 回归测试与端到端验收

- [x] 5.1 更新 `apps/desktop/src/renderer/settings/audit-settings.test.tsx`、设置工作区测试和 Header/App 测试，覆盖默认 Provider、主题顺序、独立内容、返回后 Session/Composer 状态保持及互斥菜单回归。
- [x] 5.2 更新 `/clear` slash command 测试和 Electron 退出测试，证明清空能力仍可用且设置导航不再提供重复清空入口，正常关闭 App 仍走 `terminate_all`。
- [x] 5.3 更新 `apps/desktop/e2e/runtime-workspace.spec.ts`、`workspace.spec.ts` 及相关清空会话场景：验证设置工作区导航、Provider→Model/MCP/ACP/Audit 切换、返回工作区、无“退出 Core”入口和审计详情操作。
- [x] 5.4 为审计 Core/IPC/Renderer 增加端到端或契约场景，覆盖 Agent Task 聚合、外部 transaction 聚合、独立事件、筛选分页、轮询停止、脱敏和过期清理确认/取消。
- [x] 5.5 运行受影响包的 Vitest、Renderer 类型检查和 Electron/Playwright 场景，修复由审计 DTO 变更引起的所有旧 mock、fixture 和调用方回归；不得覆盖 `packages/ui-platform/src/agent/agent-timeline-state.ts` 及其已有用户改动。

## 6. 最终验证与交付检查

- [x] 6.1 运行仓库 lint、typecheck、相关测试和构建命令，确认没有新增 TypeScript、IPC schema、可访问性或打包错误。
- [x] 6.2 检查审计查询响应始终有界、Renderer 不接收原始 payload/秘密/完整输出，并用敏感样本测试验证 redactor 失败时 fail-closed。
- [x] 6.3 运行 `openspec validate refactor-settings-workspace-and-audit --strict`，核对所有 OpenSpec 任务与规格场景一致，并记录验证结果。
