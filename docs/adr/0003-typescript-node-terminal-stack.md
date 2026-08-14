# ADR-0003：采用 Electron、TypeScript 与 Node.js 终端栈

状态：已实现

## 决策

桌面端使用 Electron、React、TypeScript 和 xterm；Core 使用 Node.js/TypeScript、`node-pty`、`@xterm/headless` 和 `@xterm/addon-serialize`。业务按 workspace package 拆分。

## 当前实现

桌面入口位于 `apps/desktop`；PTY 和 Shell 逻辑位于 `@synapse-term/terminal-service`，领域模型位于 `@synapse-term/domain`，UI 组件位于 desktop renderer。

## 影响

共享 TypeScript 领域和协议类型降低了跨进程漂移，但 Electron、原生 PTY 和固定 Node Runtime 增加了打包及平台验证成本。
