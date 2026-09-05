# ADR-0001：Electron Main 持有 Terminal Session

状态：已实现

## 决策

PTY、Terminal Session 状态由 Electron Main 进程持有。Electron Renderer 只通过 preload API 和 IPC 通道读取、写入或订阅状态。

## 当前实现

`@synapse-term/session-runtime` 负责 Session 生命周期和 `SessionManager` 的运行装配；`electron-main.ts` 负责创建 runtime、Desktop IPC adapter、窗口与应用退出清理。Renderer 通过 `window.synapseTerm` preload API 请求会话/终端操作。

## 影响

Renderer 崩溃不会直接等同于 PTY 生命周期结束；窗口关闭后 Session 继续运行，重开窗口继续订阅实时输出。应用退出终止全部 Session。
