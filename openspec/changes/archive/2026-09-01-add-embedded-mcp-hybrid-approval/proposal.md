# Add Embedded MCP Hybrid Approval

## Why

裁剪后的纯终端架构（afcda9b）失去了外部接入能力，但用户需要让本机的外部 agent 客户端（如 Codex）安全地操作已共享的终端会话。develop 分支上这套能力（内嵌 MCP Server + 工具管线）已经过实现与缺陷修复验证；本变更将其按裁剪后架构做减法移植，并引入 develop 缺失的两块能力：高危调用的交互式审批卡片、执行期间的本地可见标记。

## What Changes

- 新增 Electron Main 内嵌 MCP Server：仅监听回环地址、默认关闭、Bearer token 认证（可吊销）、Streamable HTTP `/mcp` 端点
- 移植命令执行引擎（完成检测、事务、租约）、策略引擎、风险分类、输出脱敏；不移植审计日志与文件工具
- 暴露 5 个 `synapse_*` 工具：`synapse_execute` / `synapse_observe` / `synapse_wait` / `synapse_interrupt` / `synapse_status`，全部以共享 sessionId 寻址
- 三档审批模式：`read_only` / `managed` / `full`（显式选择＋高风险提示；配置损坏回退 `read_only`）
- 高危调用同步阻塞审批卡片：60 秒超时即拒（`APPROVAL_TIMEOUT` ≠ `APPROVAL_DENIED`）；按钮为允许一次／会话内放行该命令（精确匹配、随会话消失）／拒绝；Main 持 FIFO 队列串行展示
- 会话共享两段式模型＋共享文本（预置提示词块含会话 ID 与工具指引，另留裸 ID 复制）
- 设置工作区新增"MCP 服务"区块：启用开关、连接串复制、三档模式选择、Token 管理、已共享会话列表（可单独取消共享）
- 执行期间本地可见标记：会话标签徽标＋终端面板条幅；本地输入永不锁定
- 稳定错误码：`SESSION_EXPIRED` / `SESSION_NOT_READY` / `SESSION_BUSY` / `TRANSACTION_NOT_FOUND` / `POLICY_DENIED` / `APPROVAL_TIMEOUT` / `APPROVAL_DENIED`

## Capabilities

### New Capabilities

- `mcp-access`: 内嵌 MCP Server 的本机访问、会话寻址与共享、三档审批模式、审批卡片、工具 Schema 隔离、输出脱敏与稳定错误码边界

### Modified Capabilities

- `settings-workspace`: "占位内容"需求被替换——设置工作区从只读占位变为承载真实的 MCP 服务配置区（开关、连接串、模式、Token、已共享会话）

## Impact

- `apps/desktop/src/main/`：MCP 控制器、HTTP 端点生命周期、审批队列与 IPC 事件
- `apps/desktop/src/preload/`：MCP 设置、状态、审批裁决的受限 API 契约
- `apps/desktop/src/renderer/`：设置工作区 MCP 区块、审批卡片 UI、标签徽标与面板条幅
- `packages/terminal-service/`：恢复 CommandExecutor／OutputJournal 级别的执行原语与租约语义
- `packages/domain/`：风险分类、外部调用方、共享状态等领域类型
- 新增依赖：MCP SDK（Streamable HTTP）；无新增原生模块
- 安全边界：ADR-0014（范围与减法清单）、ADR-0015（混合审批模型）；token 泄露面限于本机回环
