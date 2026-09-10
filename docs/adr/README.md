# 架构决策记录

ADR 记录难以回退、缺少背景会令人困惑，并且来自真实权衡的决定。它解释当时为什么选择某条路径，不代替当前架构、用户指南或操作手册。

## 决策索引

| ADR | 状态 | 主题 |
| --- | --- | --- |
| [0001](0001-local-core-owns-terminal-sessions.md) | 已实现 | Electron Main 持有 Session |
| [0002](0002-terminal-sessions-are-transport-agnostic.md) | 已实现 | Session 与连接拓扑无关 |
| [0003](0003-typescript-node-terminal-stack.md) | 已实现 | Electron、TypeScript 与 Node.js 终端栈 |
| [0004](0004-detach-ui-without-terminating-sessions.md) | 已实现 | UI 脱离不等于终止 Session |
| [0013](0013-single-user-local-product-boundary.md) | 已实现 | 单用户本地产品边界 |
| [0014](0014-reintroduce-embedded-mcp-server.md) | 已接受 | 重新引入内嵌 MCP Server |
| [0015](0015-mcp-hybrid-approval-model.md) | 已接受 | MCP 混合审批模型 |
| [0016](0016-ui-only-probe-echo-visibility.md) | 已接受 | 完成探针回显只影响本地终端 UI |
| [0017](0017-mcp-share-boundary-output-history.md) | 已接受 | Sharing 边界内的 PTY 输出历史 |
| [0018](0018-mcp-execution-context-guard.md) | 已接受 | 外部执行的执行上下文校验 |
| [0019](0019-mcp-external-input-tool.md) | 已接受 | 交互事务与外部输入 |
| [0020](0020-runtime-package-modularization.md) | 已接受 | Runtime implementation 下沉到 workspace packages |
| [0021](0021-explicit-github-application-updates.md) | 已接受 | GitHub 应用更新与明确安装授权 |
| [0022](0022-documentation-information-architecture.md) | 已接受 | 按读者任务划分文档并建立唯一事实来源 |

当前仓库不包含编号 `0005` 至 `0012` 的 ADR，现有记录也没有说明缺失原因。ADR 编号不回收，也不通过重命名填补空缺。

## 状态

- **提议**：仍在评审，不能作为强制边界。
- **已接受**：决策已经生效，相关实现可能仍在推进。
- **已实现**：决策已经在当前代码中落地。
- **已取代**：保留历史，但由后续 ADR 接管当前规则。
- **已拒绝**：记录评估过但未采用的方案。

## 维护规则

- 新 ADR 使用 [模板](template.md)，编号递增。
- 已接受 ADR 不重写成当前实现手册；实施状态放在架构、Reference 或维护者文档。
- 改变既有决定时新增 ADR，并在新旧两份记录中标明取代关系。
- 可以修正错别字、失效链接和不改变含义的术语，但应保持原始背景与权衡可追溯。
- 当前事实以[架构说明](../architecture/architecture.md)、[安全边界](../security/security.md)及相应 Reference 为准。
