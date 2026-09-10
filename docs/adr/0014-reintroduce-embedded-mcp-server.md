# ADR-0014：重新引入内嵌 MCP Server

状态：已接受

## 决策

历史背景：`feat/trim-terminal-slim` 分支在裁剪外部接入（afcda9b）之后，重新引入当时 develop 分支已验证的内嵌 MCP Server 方向。该背景保留用于解释迁移来源；当前产品语义见[连接外部客户端](../guides/connect-external-client.md)。移植采取“搬回旧引擎做减法”而非重写：

- 保留：命令执行管线（完成检测、事务、租约）、策略引擎、风险分类、输出脱敏
- 砍掉：审计日志（符合 ADR-0013 本地单用户边界，不做集中审计收集）、只读文件三工具及其 `LocalFileService` 依赖
- 当时将工具面前缀由 `terminal_*` 更名为 `synapse_*`，包含 `synapse_execute`、`synapse_observe`、`synapse_wait`、`synapse_interrupt` 和 `synapse_status`；后续扩展后的当前八个工具见[MCP 工具参考](../reference/mcp-tools.md)。

## 背景

裁剪分支的 SessionActor 仅剩裸写入能力，无法支撑当时 agent loop 所需的执行完成检测与输出读取。历史实现已经在 develop 上验证；这里保留该迁移理由，不把分支状态当作当前产品事实。

## 影响

MCP Server 为 Electron Main 的可选模块，仅监听回环地址、默认关闭；会话共享仍为两段式手动复制，不提供对外枚举。
