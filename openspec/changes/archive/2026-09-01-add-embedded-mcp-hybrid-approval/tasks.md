# Tasks: Add Embedded MCP Hybrid Approval

## 1. 领域类型与执行原语（packages）

- [x] 1.1 在 `packages/domain/` 新增风险分类类型 `CommandRisk`（observe/low/high 含特权与破坏性/unknown）、`ExternalCaller`、会话共享状态类型与稳定错误码联合类型，附同目录单测
- [x] 1.2 从 develop 移植命令完成检测与输出缓冲原语到 `packages/terminal-service/src/session/`，适配裁剪后的 SessionActor 事件流，TDD 先行
- [x] 1.3 实现外部租约语义（外部调用者 + Session 粒度的 JIT 租约、释放与 `SESSION_BUSY`），TDD 先行
- [x] 1.4 实现事务生命周期（execute 开启 / wait 收敛 / interrupt 中断）并暴露给包出口 `src/index.ts`，TDD 先行

## 2. 策略引擎与脱敏管线

- [x] 2.1 移植 PolicyEngine 与三档审批裁决矩阵（read_only / managed / full），含配置损坏回退 read_only 的用例，TDD 先行
- [x] 2.2 移植 SecretRedactor 输出脱敏规则集，验证三档模式统一生效，TDD 先行
- [x] 2.3 组装 ExternalToolPipeline：入口裁决→租约获取→执行→脱敏返回，覆盖矩阵全部格子与未分类弹卡路径的集成测试

## 3. MCP Server 与工具注册（apps/desktop/src/main/mcp/）

- [x] 3.1 引入 MCP SDK（Streamable HTTP），实现仅回环监听、默认关闭的内嵌端点骨架，附开关生命周期测试
- [x] 3.2 实现 Bearer token 认证与吊销即时生效（未完成调用一并拒绝），TDD 先行
- [x] 3.3 注册五个 `synapse_*` 工具及完整 inputSchema，校验错误码开头契约（SESSION_EXPIRED / SESSION_NOT_READY / SESSION_BUSY / TRANSACTION_NOT_FOUND / POLICY_DENIED / APPROVAL_TIMEOUT / APPROVAL_DENIED），TDD 先行
- [x] 3.4 实现失效会话管线注册清理（PTY 退出 / 取消共享后无残留执行器），TDD 先行
- [x] 3.5 实现 `synapse_status` 只读探测（ready / not_ready / expired，不建租约不写终端），TDD 先行

## 4. 审批卡片通道（Main ↔ preload ↔ Renderer）

- [x] 4.1 在 Main 实现审批队列：FIFO 串行推送、60 秒超时计时、裁决回传、APPROVAL_TIMEOUT 与 APPROVAL_DENIED 区分，TDD 先行
- [x] 4.2 扩展 preload 受限 API：审批事件订阅与裁决提交、MCP 设置读写、共享会话列表操作，附契约测试
- [x] 4.3 实现会话内放行记忆：精确全文匹配、存于会话管线缓存、随会话关闭销毁不落盘，TDD 先行
- [x] 4.4 实现 Renderer 模态审批卡片组件：命令全文、目标会话、风险理由、三个动作按钮，附组件测试
- [x] 4.5 接入窗口抢注意力（任务栏闪烁/请求焦点），验证最小化场景可达

## 5. 会话共享与执行标记（Renderer）

- [x] 5.1 终端标签新增共享动作：生成共享文本（sessionId＋工具清单＋连接前提）写入剪贴板，并提供裸 ID 次级复制按钮
- [x] 5.2 实现事务期间标签徽标（悬停显示命令全文与来源）与面板顶部条幅，wait 挂起期间持续、收敛或打断后消失
- [x] 5.3 验证执行期间本地键盘输入不被锁定或拦截的回归测试

## 6. 设置工作区 MCP 区块（Renderer）

- [x] 6.1 按 settings-workspace delta 更新设置工作区：移除占位内容，新增"MCP 服务"导航入口与区块框架
- [x] 6.2 实现启用开关（默认关）与运行状态展示、连接串复制（仅启用后可用）
- [x] 6.3 实现审批模式三选一与完全权限高风险提示文案，保存经 sanitize 白名单校验
- [x] 6.4 实现 Token 管理：生成、吊销、显示/隐藏、复制
- [x] 6.5 实现已共享会话列表与会话级取消共享，取消后调用返回 SESSION_EXPIRED

## 7. 端到端验证与收尾

- [x] 7.1 补充 Playwright 场景：启用 MCP → 复制连接串 → mock 外部调用触发审批卡片 → 裁决路径（允许一次／会话内放行／拒绝／超时）
- [x] 7.2 运行全量 `pnpm verify`（格式、ESLint、类型检查、Vitest）并修复发现的问题
- [x] 7.3 运行 `pnpm test:e2e`，确认既有终端流程无回归
