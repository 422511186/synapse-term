# MCP 安全模型

MCP 安全模型围绕四个边界展开：本机端点、显式 Sharing、执行前上下文和输出脱敏。

## 本机端点

内嵌 MCP Server 默认关闭，只绑定 `127.0.0.1`，每次请求要求 Bearer Token。它不是远程服务，也不提供 Session 枚举。

## 显式 Sharing

外部客户端只能访问用户提供的 `sessionId` 对应 Session。取消 Sharing、Session 退出、Token 吊销或服务关闭会清理共享句柄、审批和外部事务。

## 执行前上下文

外部客户端先通过 `synapse_observe` 获取当前输出和 `executionContextId`，再把它作为执行前提提交命令。用户输入、外部提交或 PTY environment 变化会使旧 ID 失效；服务在真正写入前再次校验，避免把旧观察或旧审批用于新的终端状态。

这是一种并发护栏，不是对远程主机权限或实际影响的保证。`unknown` 事务表示结果无法确认，不能自动重试。

## 审批与输入

`read_only`、`managed` 和 `full` 是三档审批模式。`managed` 下高危或未分类调用进入审批卡片，超时按拒绝处理；`full` 放行执行权，但不关闭输出脱敏。

交互事务的 stdin 能力独立于审批结果，由 `one_shot` 或 `bounded` 的有限 Input Grant 控制。结构化命令不会自动获得后续输入权限；自由输入也不是免审批通道。

## 输出与秘密

对外输出从 Sharing 边界之后开始，经过协议帧清理、敏感字段脱敏和有限窗口分页。完成 Probe 仍会写入当前 PTY；隐藏 Probe 回显的设置只影响本地 UI，不保证目标 Shell、SSH 或远程服务器不会记录它。

密码或其他秘密仍可能出现在 PTY 回显、终端 UI、Sharing 输出历史或审批卡片中。不要把秘密放进 Share Text、公开 Issue 或日志。

完整安全边界和更新信任细节见[安全边界](../security/security.md)。
