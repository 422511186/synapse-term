# ADR-0001：本地 Core 持有 Terminal Session

状态：已实现

## 决策

PTY、Terminal Session 状态、命令事务、Agent 任务和审计由独立的本地 Node.js Core 持有。Electron Renderer 只通过 preload 和 Core API 读取、写入或订阅状态。

## 当前实现

`apps/core/src/core-application.ts` 负责装配 `SessionManager`、Agent、策略、Repository 和 IPC；`apps/desktop/src/main/core-supervisor.ts` 负责启动、连接和退出 Core。Core 与桌面端通过认证 Named Pipe 通信。

## 影响

Renderer 崩溃不会直接等同于 PTY 生命周期结束，但桌面端仍需显式处理重连和 Core 终止；跨进程协议必须保持版本化。
