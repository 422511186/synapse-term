## 1. Domain 层

- [ ] 1.1 `packages/domain/src/external/external-caller.ts`：`ExternalErrorCode` union 新增 `'TRANSACTION_NOT_ACTIVE'`

## 2. Terminal-service 层

- [ ] 2.1 `session-actor.ts`：新增 `writeExternalInput(data)`（enqueue → running 检查 → 裸写；不校验、不轮换、不动代际，见 design D3）
- [ ] 2.2 `session-actor.ts`：新增 `writeExternalFreeform(data, expectedContextId)`（校验 contextId → `#invalidateEnvironment()` → 写入 → 返回新 contextId，见 design D3/D4）
- [ ] 2.3 `command-executor.ts`：新增 `respond(transactionId, payload)` 返回 `'written' | 'not-found' | 'not-active'` 三态（校验模式照抄 `interrupt`，不触碰 ActiveRun，见 design D2）
- [ ] 2.4 `command-executor.test.ts`：respond 三态用例 + respond 后事务照常收敛用例

## 3. MCP 层

- [ ] 3.1 `mcp-tools.ts`：`MCP_TOOL_NAMES` 补 `synapse_input`；`STABLE_ERROR_CODES` 补 `TRANSACTION_NOT_ACTIVE`；"仅提供五个"文案改六个（含 `mcp-controller.ts` default 分支）
- [ ] 3.2 `mcp-tools.ts`：`registerTool(synapse_input)`（Zod schema：sessionId / 互斥的 transactionId·expectedContextId / text·keys；description 写明双模式语义、"需要回车请带 \n 或 keys:[enter]"、响应不含原文、三场景推荐循环）
- [ ] 3.3 `mcp-tools.ts`：`validateToolInput` 新增 synapse_input 分支（互斥校验、text/keys 至少其一、text 控制字符只放行 `\n`、keys 枚举校验）
- [ ] 3.4 键序映射表：26 键 → PTY 转义序列（design D6 表：方向键/enter/esc/tab/backspace/delete/home/end/pageup/pagedown/space/f1–f12，xterm 惯例）；`text` 的 `\n` → `\r` 规范化
- [ ] 3.5 `external-tool-pipeline.ts`：`input()` 事务内模式（disposed/pty 检查 → 租约同 caller 重入 → `executor.respond` 三态映射 → 写入前游标 + 固定输出窗口读增量 → 响应含事务快照 → finally **不清租约**，见 design D8）
- [ ] 3.6 `external-tool-pipeline.ts`：`input()` 自由模式（read_only 拒绝 → 活动事务 `SESSION_BUSY` 指引改带 transactionId → contextId 缺失/失配 → 租约 → 审批：managed 弹卡明文可读表示 / full 放行 / 会话内放行按表示串匹配 → `#ensureContext` 再验证 → `writeExternalFreeform` → 输出窗口 → finally 清租约 → 响应含新 contextId，见 design D5/D7/D8）
- [ ] 3.7 `mcp-controller.ts`：`callTool` switch 新增 `synapse_input` 分发

## 4. 测试

- [ ] 4.1 `external-tool-pipeline.test.ts`：事务内全链路（execute → input 密码 → 探针帧 → wait 收敛；`writes` 顺序断言：命令 → 探针 → 密码）
- [ ] 4.2 `external-tool-pipeline.test.ts`：`TRANSACTION_NOT_FOUND`（不存在/已终态）与 `TRANSACTION_NOT_ACTIVE`（未 sent 窗口）
- [ ] 4.3 `external-tool-pipeline.test.ts`：自由输入（写入 + 响应新 contextId + `capabilityEpoch` +1 断言；`EXECUTION_CONTEXT_STALE` / `EXECUTION_CONTEXT_REQUIRED`）
- [ ] 4.4 `external-tool-pipeline.test.ts`：自由输入遇活动事务 → `SESSION_BUSY` 且文案含 transactionId 指引
- [ ] 4.5 `external-tool-pipeline.test.ts`：审批矩阵（read_only 拒绝；managed 弹卡 allow / deny / timeout；full 放行；会话内放行对重复键序列生效、对变体不生效）
- [ ] 4.6 `external-tool-pipeline.test.ts`：响应 JSON 序列化不含 text 原文（防回归）；text+keys 同传顺序；`\n` → `\r` 规范化
- [ ] 4.7 `external-tool-pipeline.test.ts`：审批等待期间用户 `writeUser` → 自由输入被 `EXECUTION_CONTEXT_STALE` 拒绝（再验证路径）
- [ ] 4.8 `external-tool-pipeline.test.ts`：26 键映射逐键断言 + text 控制字符拒绝 + keys 白名单外拒绝
- [ ] 4.9 `mcp-tools.test.ts`：schema 互斥/缺参/超长/控制字符；`TRANSACTION_NOT_ACTIVE` 错误序列化透传

## 5. 规格与文案同步

- [ ] 5.1 主 spec 同步：`openspec/specs/mcp-access/spec.md` 按本 change 的 `specs/mcp-access/spec.md` delta 合并（Synapse Tool Surface 六工具、Stable External Error Codes 补码、External Interactive Input 新需求——archive 时执行）
- [ ] 5.2 `apps/desktop/src/renderer/mcp/share-text.ts`：`MCP_TOOLS` 数组（L1-7）加入 `synapse_input`（共享文本 L57「可用工具：…」自动拼接），并新增一条操作规则说明交互输入用法（事务内输入补密码 / 自由输入需 expectedContextId 且响应返回新 ID）；`share-text.test.ts` 同步断言工具清单与关键规则文案（已勘察确认：现为硬编码五工具 + 9 条规则均未提及输入能力）

## 6. 验证

- [ ] 6.1 全量单测通过（vitest：terminal-service + apps/desktop mcp 目录）
- [ ] 6.2 lint 与 typecheck 通过
