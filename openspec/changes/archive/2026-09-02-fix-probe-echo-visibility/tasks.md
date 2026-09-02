## 1. 固定回归行为

- [x] 1.1 在 `packages/terminal-service/src/session/session-actor.test.ts` 先补充失败测试：命令完成 Probe 和环境识别 Probe 的回显分别跨多个 PTY 数据块，并插入自动换行、ANSI/重绘控制序列和被拆开的控制序列；验证隐藏模式不显示完整 Probe，同时保留用户命令、普通输出和提示符。
- [x] 1.2 在 `packages/terminal-service/src/session/command-executor.test.ts` 补充完成帧先到、Probe 回显后到的回归测试；验证回显晚于现有 completion drain 但处于收尾窗口时仍不进入本地终端 UI，且普通延迟 stdout 仍进入事务输出。
- [x] 1.3 补充设置动态切换覆盖（必要时更新 `packages/terminal-service/src/session/session-actor.test.ts` 和 `apps/desktop/src/main/terminal-host.test.ts`）；验证 Probe 回显进行中切换隐藏值只影响后续 UI 事件，不重写已交付文本，也不改变协议事件、PTY 写入和完成结果。

## 2. 实现流式 Probe 回显抑制

- [x] 2.1 重构 `packages/terminal-service/src/session/session-actor.ts` 的命令完成 Probe 和环境识别 Probe 匹配状态，使身份标记、结束边界、终端布局控制序列及自动换行能够跨 chunk 保持 carry；验证不使用全局换行/控制字符清理，并在候选失配时恢复未确认的普通文本。
- [x] 2.2 在 `packages/terminal-service/src/session/session-actor.ts` 增加完成帧后的有界回显收尾生命周期，覆盖完成帧先到、回显边界已消费、超时、Session dispose 和新 Probe 替换；验证收尾状态不会无限累积，也不会让过期 nonce 隐藏后续用户输出。
- [x] 2.3 保持协议输出与本地终端 UI 输出的独立路由，并让 `hideCompletionProbeEcho` 在事件交付时决定 UI 是否显示已识别 Probe；验证 `ShellProbe`、`CommandExecutor`、OSC 777 隔离、输出 buffer 和 PTY 写入行为与开关无关。

## 3. 集成验证与交付检查

- [x] 3.1 运行终端服务相关 Vitest（至少覆盖 `session-actor.test.ts`、`command-executor.test.ts` 及现有 Shell Probe 测试），确认新增分块、换行、重绘、延迟和误匹配场景通过。
- [x] 3.2 运行 `pnpm verify`，确认格式、ESLint、TypeScript 和全量 Vitest 通过；若失败，修复本变更引入的问题并保留既有用户改动。本 Change 相关检查均通过；全仓 ESLint 唯一剩余错误位于未被本 Change 修改的 `.agents/skills/setup-ts-deep-modules/dependency-cruiser.config.cjs:27`（`module is not defined`）。
- [x] 3.3 运行 `openspec validate fix-probe-echo-visibility --type change --no-interactive` 并复核 proposal、design、delta spec、tasks 的范围一致，确认 change 可交给 `/opsx:apply` 实施。
