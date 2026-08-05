## Context

当前 Renderer 的 `App` 通过 `currentView` 切换工作区、模型、Provider、MCP、ACP 和审计页面，但右上角设置按钮仍打开一个混合下拉菜单。现有模型、Provider、MCP、ACP 页面已经各自具备独立的加载和写操作，只缺少统一的设置工作区外壳。

当前审计数据以 `audit_events` 追加写入，`AuditService` 提供按 Session/Task 的基础查询，Core handler 只返回 `id/type/sessionId/taskId/occurredAt/summary`。其中 `summary` 只从少数 payload 字段中挑选一个字符串，无法表达发起者、风险、审批、结果和错误原因。审计保留策略已经存在：原始终端日志默认 24 小时，结构化审计默认 30 天；`audit.cleanup` 已有 Core/Preload 通道，但没有审计页面入口。

本变更必须继续遵守现有审计边界：Audit Record 不是终端录像；Protected Input、秘密和完整终端输出不得进入长期审计或 Renderer；外部调用不得伪造 Agent Task/Turn。当前 App 退出流程已经在 Electron `before-quit` 中以 `terminate_all` 关闭 Core，因此设置页不再承担 Core 生命周期动作。

## Goals / Non-Goals

**Goals:**

- 提供一个独立设置工作区，使用固定左侧分组导航和右侧设置主题内容。
- 保留 Provider、Model、MCP、ACP 主题的独立职责和已有 API 操作，默认从 Provider 主题开始。
- 删除设置菜单中的 Agent 会话清空和 Core 退出入口；`/clear` 和 App 正常退出行为保持有效。
- 将审计从摘要平铺升级为面向安全与执行诊断的 Audit Trace 聚合视图。
- 支持全部 Session 的全局审计范围、最近 7 天默认窗口、时间/Session/发起者/类别/结果/风险筛选、脱敏关键词搜索、每页 25 条的表格分页、自动刷新和独立详情弹窗。
- 为列表提供统一 Audit Outcome，为详情提供脱敏命令/路径摘要、原始事件类型、策略/审批信息、退出码和原因。
- 提供仅清理过期记录的确认操作，并显示当前保留策略。

**Non-Goals:**

- 不合并 Provider 与 Model 为一个配置页面。
- 不新增跨 MCP、ACP 和 Core 的外部 trace ID；外部终端命令链只使用已有 `transactionId` 聚合。
- 不把完整终端输出、终端录像、Protected Input 或原始秘密暴露给审计 UI。
- 不提供审计全量删除、任意保留期编辑或第一版导出。
- 不改变 Core 正常退出时终止所有 Session 的生命周期语义。
- 不新增移动端布局或新的第三方 UI/数据依赖。

## Decisions

### 1. 使用 Settings Workspace 作为 Renderer 的设置容器

新增 `SettingsWorkspace` 容器，由 `App` 在 `currentView === 'settings'` 时渲染。容器维护当前 `SettingsTopic`，左侧显示可点击的一级分组和二级主题：一级分组标题点击进入该组的默认主题，二级主题使用更深缩进和独立选中态，避免两级菜单混淆：

- 配置：服务商配置、模型配置
- 外部接入：MCP 服务、ACP 集成
- 安全与诊断：审计日志

设置按钮直接切换到设置工作区并选中服务商配置；容器拥有返回工作区的入口。现有设置页面保留各自的业务状态和 DesktopApi 调用，但将重复的“返回工作区”外壳上移，避免每个主题再伪装成独立全屏页面。

**备选方案：**继续扩展 Header 下拉菜单会继续混合配置和生命周期动作；把所有配置合并成一页会让 Provider、Model、MCP、ACP 的加载状态和操作模型相互干扰，因此都不采用。

### 2. 仅从设置导航中移除清空和 Core 退出动作

删除 Header 设置菜单的清空 Agent 会话按钮及其直接入口，保留 slash command `/clear` 调用现有 `resetConversation` 流程。删除 Renderer 的“退出 Core”菜单动作和对应确认入口；Electron `before-quit -> requestExit('terminate_all')` 以及底层 `core.shutdown`、`CoreSupervisor.requestExit` 保留，用于正常应用退出、测试和受控生命周期调用。

**备选方案：**把退出 Core 放入设置工作区的“系统”主题会重新混入应用生命周期；把 `/clear` 和配置放在同一导航会造成重复入口，因此都不采用。

### 3. 以结构化 Audit Trace 投影替代摘要字符串

保留 `audit_events` 作为追加式事实源，不直接把基础设施 payload 透传给 Renderer。新增应用层审计查询投影，返回两类稳定 DTO：

- 列表 `AuditTraceView`：trace key、主体类型、Session/Task/transaction 关联、发起者、操作类别、开始/最后时间、统一结果、最高风险、脱敏摘要、事件数量和是否包含观察事件。
- 详情 `AuditTraceDetailView`：列表摘要加按时间正序的结构化事件数组；事件只包含用户可读的类型、时间、主体、策略/审批/风险/退出码/原因、脱敏命令或路径摘要和稳定关联 ID，不返回任意原始 payload。

聚合键完全使用现有领域标识：

- 内置 Agent：`taskId` 非空时使用 `task:<taskId>`。
- 外部终端命令：payload 中有 `transactionId` 时使用 `transaction:<transactionId>`，从而把 execute/wait/interrupt 关联起来。
- 没有上述关联的 Session、Provider、Model、观察、拒绝和其他事件：使用 `event:<eventId>` 独立展示。

这样不会伪造外部 Task/Turn，也不会为了 UI 引入新的跨协议关联合同。列表查询按时间范围和筛选条件获取有界事件，在应用层聚合后以 trace 游标分页；详情按 trace key 单独查询完整事件链。Repository 查询必须使用时间、Session、Task 等索引，避免通过现有无界 `listAuditEvents()` 把全部数据库记录发送到 Renderer。

**备选方案：**直接返回 `payload` 可以减少投影代码，但会泄露基础设施字段并让 UI 依赖内部 schema；新增独立持久化 `audit_traces` 表可进一步优化大数据量，但当前单用户、30 天保留期和已有事件量不足以承担额外读模型迁移，先采用有界查询加应用层聚合，并以查询性能测试作为升级读模型的触发条件。

### 4. 保留命令哈希并增加脱敏可读摘要

`AuditService.recordCommand` 继续记录命令哈希、风险、授权、退出码和原因，同时对命令文本经过现有 `SecretRedactor` 后写入 `commandPreview`。文件操作写入脱敏路径摘要；旧事件没有摘要时显示事件类型、哈希或可用原因，不补造原始命令。Protected Input 不经过该路径，完整输出仍不进入审计投影。

**备选方案：**只保留 hash 能提供完整性关联但无法回答“做了什么”；保留原始命令能提高可读性但突破秘密保护和长期留存边界，因此选择脱敏摘要。

### 5. 统一筛选、结果和观察噪声规则

查询 DTO 支持 `from/to/sessionId/actor/category/outcome/risk/search/includeObservations/limit/cursor`。默认窗口为最近 7 天、范围为全部 Session、列表最新优先；详情事件保持时间正序。应用层根据 trace 事件归一化为 `in_progress/success/failure/rejected/interrupted/information`，并把事件归类为命令、审批、文件、会话、配置、外部调用或观察。

成功的 `external.observe`、成功的 `external.status`、成功的 `session.probe` 和成功的资源观察默认不进入主列表；失败观察始终可见；`includeObservations` 显式开启后可查询所有保留事件。关键词只匹配脱敏摘要、原因、Session 标识和关联 ID。

**备选方案：**逐条展示所有事件会让高频观察压过审批和失败记录；只保留执行事件则会损失安全证据，因此采用“全部保留、默认隐藏成功观察”的两层策略。

### 6. 扩展桌面审计 API，但不把原始 payload 透传

保持 `audit.list` 作为桌面到 Core 的审计查询入口，但将返回值升级为带 `items/nextCursor` 的分页结果；增加按 trace key 获取详情和读取保留策略的只读请求。保留现有 `audit.cleanup` 返回清理计数。Preload 只暴露这些稳定 DTO，Core protocol、application handler、Electron bridge 和 Renderer mock/test 同步更新。

审计页在挂载时以最近 7 天和默认筛选加载，使用 5 秒有界轮询刷新当前查询，卸载时清理定时器；刷新不清除已选 trace、搜索和筛选。详情加载失败只影响当前详情弹窗，不清空表格列表。

**备选方案：**新增独立 `audit.traces` 方法可避免旧 `audit.list` 返回形态变化，但会同时维护两套桌面契约；当前 `audit.list` 没有外部产品消费者，统一升级它的 schema 更容易保持单一事实源。

### 7. 清理只面向过期数据

审计页只在右上角提供普通的“保留策略”入口。点击后打开保留策略弹窗，读取并展示 RetentionManager 的当前策略（审计 30 天、原始日志 24 小时），清理入口只存在于该弹窗内；点击清理时先确认，再调用既有 `audit.cleanup`，显示删除的 raw logs 和 audit events 数量。清理不会按用户筛选删除，也不会清空未过期事件；第一版不提供任意保留期编辑或导出。

**备选方案：**提供“清空审计”虽然实现简单，但会破坏安全排查证据；允许随意改保留期还需要新的持久化配置和迁移，因此不采用。

## Risks / Trade-offs

- [事件类型和 payload 不完全一致] → 通过稳定分类/结果映射和 `information` 回退，详情保留原始 type，不伪造缺失状态。
- [有界事件查询在大量事件下仍可能需要聚合计算] → 为时间/Session/Task 建索引，限制默认窗口和响应页大小，增加聚合查询性能测试；超过本地基线后再引入持久化读模型。
- [脱敏命令摘要仍可能包含未识别秘密] → 复用现有 `SecretRedactor`，增加命令、路径、错误原因的敏感样本测试；任何 redactor 失败按安全占位符处理。
- [旧审计事件缺少 commandPreview 或 transactionId] → 详情采用可用字段降级，使用 event key 独立展示，不对历史记录做不可逆迁移。
- [轮询增加 Core 查询负载] → 仅在审计工作区可见时以 5 秒间隔轮询，使用游标和有界窗口，离开页面立即取消。
- [清理操作不可逆] → 只允许过期清理，确认对话框显示策略和计数，复用统一 pending/防连点反馈。
- [现有设置页面局部状态在主题切换时卸载] → 业务数据仍通过真实 API 保存；主题切换不触发写入，不在容器层复制配置状态。

## Migration Plan

1. 先扩展审计领域/Repository 查询、脱敏摘要和 Core/Preload DTO，并用现有事件样本覆盖聚合、结果和敏感数据测试。
2. 实现 `SettingsWorkspace` 容器和 Header 直达入口，迁移 Provider/Model/MCP/ACP/Audit 主题，删除清空与 Core 退出 UI。
3. 实现审计表格分页、主搜索栏、高级筛选弹窗、独立详情弹窗、轮询、保留策略弹窗和过期清理确认。
4. 更新 Renderer 单元测试、Core/IPC 契约测试和 Electron/Playwright 场景，执行 OpenSpec strict validation 与仓库验证命令。

本变更不改变已有数据库事实源格式；新增 payload 字段对旧记录可选，旧记录按降级投影展示。若需要回滚，先回滚 Renderer/API 同步版本，再保留已写入的脱敏字段和数据库记录；旧代码可忽略未知 payload 字段。正常 App 退出和 Core shutdown 行为不迁移。

## Open Questions

无。产品层的设置分组、审计范围、聚合键、结果枚举、隐私边界、清理策略和导出范围已在 proposal 前确认。
