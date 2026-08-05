## Why

右上角设置下拉菜单同时承载配置入口、审计查看、清空 Agent 会话和退出 Core，随着配置项增加已经变成职责混杂的操作入口。现有审计页又只展示时间、事件类型和粗略摘要，无法回答谁在何时对哪个 Session 做了什么、经过什么授权以及最终结果如何，因此需要同步重构设置导航和审计诊断体验。

## What Changes

- 新增独立的设置工作区：设置按钮直接进入设置页，左侧按分组展示设置主题，右侧展示当前主题内容。
- 将服务商、模型、MCP、ACP 和审计拆成独立设置主题，分组为“配置”“外部接入”“安全与诊断”；服务商位于模型之前。
- 移除设置菜单中的“清空当前 Agent 会话”按钮，继续由 `/clear` 提供清空能力。
- 移除 UI 中的“退出 Core”入口；正常退出 App 继续负责终止 Core，底层 Core 关闭 API 保留。
- 将审计重构为面向安全与执行诊断的聚合视图：按 Agent Task 或外部 transaction 聚合，使用每页 25 条的表格分页，主搜索栏配合高级筛选弹窗，点击记录打开独立详情弹窗。
- 为审计提供统一结果、风险、发起者、Session、操作类别、审批和失败原因等结构化投影；命令和路径仅以脱敏摘要展示，完整终端输出、Protected Input 和终端录像不进入审计详情。
- 审计默认查看全部 Session 最近 7 天的记录，列表最新优先；成功的只读观察默认隐藏但可筛选查看。
- 在审计页右上角提供“保留策略”入口，在弹窗中展示策略并提供仅清理过期记录的确认操作；不提供清空全部审计或第一版导出。

## Capabilities

### New Capabilities

- `settings-workspace`: 独立设置工作区、分组导航和设置主题切换。

### Modified Capabilities

- `desktop-terminal`: 设置入口改为设置工作区，移除设置菜单中的 Agent 清空和 Core 退出动作，并保留工作区返回路径。
- `desktop-model-management`: Provider/Model 入口迁移到设置工作区的独立主题，替换旧的全局设置下拉顺序要求。
- `terminal-safety-audit`: 将审计查看从摘要平铺升级为表格化、可筛选、可搜索、可聚合、可弹窗查看详情的安全与执行诊断视图，并明确脱敏详情和受控清理边界。

## Impact

- Renderer：`apps/desktop/src/renderer/app.tsx`、设置页组件、审计组件和相关交互测试。
- Preload / Electron Main / Core API：扩展审计查询的筛选、分页、聚合和结构化字段投影；保留现有 Core shutdown 与 cleanup 能力，移除不再需要的 UI 调用路径。
- Infrastructure / application audit：为 Task、transaction 和独立事件建立稳定聚合投影，保存脱敏命令/路径摘要并维持命令哈希、秘密保护和留存边界。
- OpenSpec 验收：新增设置工作区契约，并更新桌面导航、模型管理、终端安全审计和交互反馈相关测试。
