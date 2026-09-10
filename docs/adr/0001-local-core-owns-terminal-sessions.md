# ADR-0001：Electron Main 持有 Session

状态：已实现

## 决策

PTY、Session 状态由 Electron Main 进程持有。Electron Renderer 只通过受限 preload API 和 IPC 通道读取、写入或订阅状态。

## 当前实现

当前实现由 `@synapse-term/session-runtime` 和 Electron Main 装配；稳定的进程边界与公共职责见[架构说明](../architecture/architecture.md)。本节不作为独立实现手册。

## 影响

Renderer 崩溃不会直接等同于 PTY 生命周期结束；窗口关闭后 Session 继续运行，重开窗口继续订阅实时输出。应用退出终止全部 Session。
