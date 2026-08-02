## 1. 共享后自动探测

- [x] 1.1 以 TDD 在 `session-handler.ts` 的 `markSessionShared` 后触发后台 Shell 探测：Shell 未就绪或环境未验证时以外部租约运行 `ShellProbe`，成功/失败均记录一条 `session.probe` 审计，失败不阻塞共享响应
- [x] 1.2 补充 `session-handler` 测试：共享后探测成功推进 ready；用户占用租约时共享仍正常返回且保持 unknown

## 2. terminal_status 状态语义

- [x] 2.1 以 TDD 更新 `external-handler.ts` 的 `terminalStatus` hint：`shell: unknown` 返回“执行一次 terminal_execute 自动探测”指引；`probing` 返回“正在探测，请稍后重试”
- [x] 2.2 补充 `external-request-handler.test.ts`：unknown 与 probing 的 hint 断言

## 3. 验证

- [x] 3.1 运行 `openspec validate session-shell-auto-probe --strict` 并产出验证记录
- [x] 3.2 运行相关专项测试（application、desktop mcp）并全部通过
- [x] 3.3 运行 `pnpm verify` 确认无回归
