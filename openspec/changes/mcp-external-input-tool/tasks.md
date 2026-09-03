## 1. Domain and protocol contracts

- [ ] 1.1 `packages/domain/src/session/command-protocol.ts`：为公开事务增加 `kind: 'structured' | 'interactive'`，保留四种公开终态；补充输入键名、输入授权模式和输入请求标识类型。
- [ ] 1.2 `packages/domain/src/external/external-caller.ts`：补充 `INPUT_WRITE_UNKNOWN`、`INTERACTIVE_START_WRITE_UNKNOWN`、`INPUT_GRANT_EXHAUSTED` 等稳定错误码；不要加入已删除的 `TRANSACTION_NOT_ACTIVE`。
- [ ] 1.3 更新 domain 公共出口与模块契约测试，确保 renderer、desktop 和 terminal-service 只能通过公共类型交互。

## 2. Terminal-service: independent interactive transaction path

- [ ] 2.1 `shell-driver.ts`：把 command-only dispatch 与 completion Probe 构造拆成独立 API；结构化 dispatch 继续保持现有 command + Probe 语义，交互启动只返回命令终止回车，并允许通过字面审计但被结构化入口拒绝的已知交互式 command。
- [ ] 2.2 `shell-driver.ts`：将字面审计/保留标记校验与结构化专用的交互命令拒绝分开，补充已知会消费 stdin 的命令识别（包括 `sudo`、`su` 等高风险提示场景）及对应测试；未知命令仍不伪装成可自动交互。
- [ ] 2.3 `session-actor.ts`：新增串行化的交互启动写入、事务内输入、自由输入和终结 Probe 写入方法；上下文校验、环境失效和“写入前不发送”必须在同一队列边界完成，并把启动 `write()` 抛错或交付不确定建模为无客户端句柄的启动写入不确定。
- [ ] 2.4 `external-lease.ts`：引入可明确持有/释放的租约句柄或等价引用计数；同 caller 的 input 重入不得释放交互事务外层租约，终态清理必须幂等。
- [ ] 2.5 新增 `interactive-command-executor.ts`（或等价独立模块）：实现 start、input、finish、wait、interrupt、clear；维护 `running`、内部 `finishing`、`completed`、`interrupted`、`unknown`，并仅在 start 的 `write()` 正常返回后暴露事务 ID；启动写入不确定时不得生成客户端可操作句柄。
- [ ] 2.6 交互执行器：finish 必须在标记 `finishing` 后才排队单独 Probe；Probe 匹配、超时、被消费和 PTY 退出的结果分别覆盖 completed/unknown，finishing 期间拒绝 input/interrupt 竞态写入。
- [ ] 2.7 交互执行器：实现显式 `inputGrantMode`（`one_shot` 或 `bounded`）授权状态、`inputRequestId` 去重、冲突 ID 拒绝、空闲超时和终态撤销；结构化 `synapse_execute` 不签发输入授权。
- [ ] 2.8 交互执行器：本地 `writeUser` 造成的 environment invalidation 必须使活动交互事务进入 unknown，保留用户输入，并释放授权与租约。
- [ ] 2.9 terminal-service 单测：验证交互命令不会收到启动 Probe，finish 才发送 Probe；验证 finish/input 竞态、用户输入、PTY 退出、超时、重复 requestId、配额耗尽、启动 `write()` 同步抛错/潜在部分写入、无 transactionId 暴露、context/epoch 失效、授权与租约清理以及禁止重试。
- [ ] 2.10 使用真实交互式 Bash/PTY 集成测试复现 `sudo su -`、`vim` 或等价 stdin reader，确认启动 payload 不包含 Probe，Probe 只在 finish 阶段写入。

## 3. MCP pipeline and tool surface

- [ ] 3.1 `mcp-tools.ts`：工具清单改为八个：`synapse_execute`、`synapse_start_interactive`、`synapse_input`、`synapse_finish_interactive`、`synapse_observe`、`synapse_wait`、`synapse_interrupt`、`synapse_status`；同步稳定错误码集合和“仅提供八个”文案。
- [ ] 3.2 `mcp-tools.ts`：注册 `synapse_start_interactive`，Schema 包含 `sessionId`、`command`、`expectedContextId`、`inputGrantMode`；明确它不附加完成 Probe、需要 finish，并返回 transactionId/inputGrantId。
- [ ] 3.3 `mcp-tools.ts`：注册 `synapse_input`，Schema 强制 transactionId + inputGrantId 组合或 expectedContextId 二选一，强制 1-256 字符且无控制字符的 inputRequestId 和 text/keys 至少一个；description 明确事务内与自由模式差异、响应不回显原文和回车规则。
- [ ] 3.4 `mcp-tools.ts`：注册 `synapse_finish_interactive`，Schema 包含 `sessionId`、`transactionId`、`observedCursor`，说明调用方必须先观察到 Shell 提示符且携带最近一次 observe 的 `nextCursor`；同步 `synapse_wait`/`synapse_interrupt` 对 interactive kind 的描述。
- [ ] 3.5 `validateToolInput`：实现互斥字段、字符串长度、文本控制字符、键白名单、UTF-8 字节上限、按键数量、合并 payload 上限、空 payload 拒绝及 `inputRequestId`/`observedCursor` 校验；验证失败不得触发 pipeline 或 PTY 写入或消耗授权。
- [ ] 3.6 新增输入编码器：按设计表把 26 个键编码为固定 xterm normal-mode bytes；规范化 `\n` 为 `\r`，计算 `textLength` 和 `payloadBytes`；禁止任意 ESC/raw bytes。
- [ ] 3.7 `external-tool-pipeline.ts`：整合结构化 executor 与 interactive executor 的活动事务查询、共享租约、状态快照和清理；不得让两个执行器产生并行活动事务。
- [ ] 3.8 `external-tool-pipeline.ts`：实现 `startInteractive()` 的环境 Probe、context 再验证、风险/审批、命令单独写入和输入授权签发；managed 将交互启动按长期可写入能力处理，按授权键检查会话内放行，未命中时弹卡，full 放行，read_only 拒绝；结构化 execute 继续沿用风险矩阵；启动写入抛错或交付不确定时映射 `INTERACTIVE_START_WRITE_UNKNOWN`，不返回句柄并完成环境、授权和租约清理。
- [ ] 3.9 `external-tool-pipeline.ts`：实现 `input()` 两种模式；事务内只接受已绑定授权，不轮换 context/epoch；自由模式拒绝活动事务、校验 context，并在同一队列边界进入写入尝试时失效环境/轮换 context，即使写入不确定也不得恢复旧 ID，成功时返回新 context。
- [ ] 3.10 `external-tool-pipeline.ts`：实现 `finishInteractive()`；原子切换 finishing、独立发送 Probe、处理完成/unknown、撤销 grant、失效 environment 和释放租约。
- [ ] 3.11 `external-tool-pipeline.ts`：实现重复 `inputRequestId` 的幂等结果、payload/模式/grant 冲突、`INPUT_GRANT_EXHAUSTED`、`OUTPUT_CURSOR_STALE`、`INPUT_WRITE_UNKNOWN` 和 `INTERACTIVE_START_WRITE_UNKNOWN` 的稳定映射；去重命中必须先于可变的授权/context 检查，验证失败和幂等重放不扣配额，禁止用新 requestId 自动重试不确定写入。
- [ ] 3.12 `mcp-controller.ts`：分发 start/input/finish 三个工具，活动事务快照标明 `kind` 且不暴露内部 `finishing` 状态；清理 Sharing、token 或端点时同时 dispose 两类 executor。
- [ ] 3.13 `external-tool-pipeline.ts`：将 `allow_session` 记忆键按 command 启动（command + execution mode + inputGrantMode）和自由输入（规范化 text + keys）分别编码；命中交互 command 时每次签发新的 inputGrantId。

## 4. Approval, sharing text and renderer-facing copy

- [ ] 4.1 `approval-queue.ts` / `approval-card.tsx`：交互启动的卡片显示原始 command、选定的输入授权档位和固定上限，不显示未来输入；结构化 execute 不产生后续输入授权。
- [ ] 4.2 自由输入 managed 审批使用规范化表示（文本原文 + 键名），会话内放行精确匹配表示；排除随机 requestId/grantId。
- [ ] 4.3 `apps/desktop/src/renderer/mcp/share-text.ts`：同步八个工具和三条标准流程：交互事务 start -> input -> observe -> finish；普通结构化 execute 不再用于已知 stdin reader。
- [ ] 4.4 `share-text.test.ts`：断言工具清单、必须先 observe、inputRequestId/inputGrantId、finish 前观察提示符和秘密保证的准确文案。

## 5. Tests and verification

- [ ] 5.1 `external-tool-pipeline.test.ts`：sudo/password、vim、交互菜单、free input、活动事务阻断、授权矩阵、context/epoch 变化、输出窗口和响应不含 text 原文；覆盖交互启动写入同步抛错、潜在部分写入、无公共事务句柄和重新 observe 要求。
- [ ] 5.2 `external-tool-pipeline.test.ts`：finish 被过早调用时 Probe 被消费或超时进入 unknown；finishing 阶段的 input/interrupt 不写入下一个提示符。
- [ ] 5.3 `external-tool-pipeline.test.ts`：one_shot/bounded 授权边界、网络重试使用相同 requestId 不重复写入（包括授权已消费或 context 已轮换后的重试）；相同 ID 携带不同 payload、输入模式或 grant 被拒绝；空 payload、校验失败和幂等重放不消耗授权；去重记录不保留原始 text 并随 Sharing 清理；自由输入未知写入仍失效 context；未知写入不得用新 ID 自动重放。
- [ ] 5.4 `mcp-tools.test.ts`：八工具 Schema、互斥/缺参/超长/控制字符/键白名单/字节计数/`observedCursor`/稳定错误码。
- [ ] 5.5 `embedded-mcp-server.test.ts`：真实 Streamable HTTP `tools/list` 恰好返回八个工具，并检查三个新增工具的描述和参数。
- [ ] 5.6 `mcp-controller.test.ts`：start/input/finish 全链路、跨工具 lease、unshare/token revoke 清理和活动事务状态。
- [ ] 5.7 按 `docs/engineering/testing.md` 运行 terminal-service、desktop MCP、domain 单测及真实 PTY 集成测试；补充无法安装依赖时的明确验证记录。

## 6. Documentation and validation

- [ ] 6.1 修订 `openspec/changes/mcp-external-input-tool/specs/mcp-access/spec.md`：八工具 Surface、交互事务生命周期、输入授权、去重、终结 Probe、错误和限制场景。
- [ ] 6.2 复核 delta 与现有 `openspec/specs/mcp-access/spec.md` 的边界；本 change 完成前不直接修改主 spec，归档时再同步。
- [ ] 6.3 修订 `docs/adr/0019-mcp-external-input-tool.md`，记录独立交互入口、显式 finish、有限输入授权和真实秘密保证；修订 `CONTEXT.md` 术语。
- [ ] 6.4 运行 `openspec validate mcp-external-input-tool --type change --strict`，再运行 format check、lint、typecheck 和相关测试。
