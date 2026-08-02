# ADR-0010：内置 Agent 工具绑定单个 Terminal Session

状态：已更新并实现

## 决策

一个内置 Agent Task 只能操作一个选定 Session。除该 Session 外，Agent 还可使用受限的本机 home 文件工具；它不能枚举或切换其他 Session，也不能直接访问本机进程、浏览器或任意网络客户端。

## 当前实现

内置工具 Schema 不暴露可切换的 Session 参数；`AgentCoordinator`、`ToolGateway` 和 `LocalFileService` 分别绑定 Session 与动态 home 根目录。MCP/ACP 是外部调用边界，必须额外提供 shared Session ID。

## 影响

工具结果、租约和审计天然归属于一个 Session。增加新的本机或插件能力必须重新设计根目录、权限和审计边界。
