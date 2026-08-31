# ADR-0014：本分支重新引入内嵌 MCP Server

状态：已接受

## 决策

`feat/trim-terminal-slim` 分支在裁剪外部接入（afcda9b）之后，重新引入 develop 已验证的内嵌 MCP Server 方向：Synapse Term 作为 MCP Server，把已共享的终端会话以工具形式暴露给本机外部客户端（如 Codex）。移植采取"搬回旧引擎做减法"而非重写：

- 保留：命令执行管线（完成检测、事务、租约）、策略引擎、风险分类、输出脱敏
- 砍掉：审计日志（符合 ADR-0013 本地单用户边界，不做集中审计收集）、只读文件三工具及其 `LocalFileService` 依赖
- 工具面前缀由 `terminal_*` 更名为 `synapse_*`：`synapse_execute / observe / wait / interrupt / status`

## 背景

裁剪分支的 SessionActor 仅剩裸写入能力，无法支撑无人值守 agent loop 所需的执行完成检测与输出读取。develop 上这套机制已实现并修复过 Critical 级缺陷，重写必然引入回归风险。

## 影响

MCP Server 为 Electron Main 的可选模块，仅监听回环地址、默认关闭；会话共享仍为两段式手动复制，不提供对外枚举。
