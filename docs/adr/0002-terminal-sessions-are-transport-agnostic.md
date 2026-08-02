# ADR-0002：Terminal Session 与连接拓扑无关

状态：已实现

## 决策

系统建模的是已经准备好的终端环境，而不是 SSH 连接、服务器、跳板机或容器对象。用户先在终端内完成连接，Agent 再使用当前 Session。

## 当前实现

`SessionState` 只记录 PTY、Shell、执行方言、环境探测和租约；`packages/terminal-service/src/ssh-hop-scenarios.test.ts` 验证嵌套连接仍按同一个终端语义工作。

## 影响

产品不提供主机资产枚举、远端凭据管理或连接拓扑恢复。进入 SSH、容器或 WSL 后，用户需要重新确认执行方言。
