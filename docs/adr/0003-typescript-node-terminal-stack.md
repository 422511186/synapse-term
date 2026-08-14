# ADR-0003：采用 Electron、TypeScript 与 Node.js 终端栈

状态：已实现

## 决策

桌面端使用 Electron、React、TypeScript、xterm 与 `node-pty`；PTY 与终端逻辑按 workspace package 拆分，Electron Main 单进程持有。

## 当前实现

桌面入口位于 `apps/desktop`；PTY 和 Shell 逻辑位于 `@synapse-term/terminal-service`，领域模型位于 `@synapse-term/domain`，UI 组件位于 desktop renderer。

## 影响

共享 TypeScript 领域类型降低了模块间漂移，但 Electron、原生 PTY 增加了打包及平台验证成本。
