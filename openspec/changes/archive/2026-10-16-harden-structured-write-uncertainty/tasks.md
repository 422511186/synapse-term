# Tasks

## 1. 第一刀：结构收敛（无可观察变更）

- [x] 1.1 先建立基线对照测试：覆盖结构化执行、交互启动、事务内输入、自由输入四条路径在各自前提失败（未释放、PTY 未运行、environment 未验证、capability epoch 不匹配、executionContextId 不匹配、已取消）下返回的外部错误码，运行 `pnpm vitest run packages/terminal-service packages/mcp-runtime` 记录现状结果作为本组的不变量基线
- [x] 1.2 在 `packages/domain/src/session/session-state.ts` 增加前提判定纯函数（输入 `SessionState`、前提描述与「是否已取消」布尔，输出前提错误码或空），并先在 `session-state.test.ts` 写出覆盖三档前提 × 六类状态的失败断言再实现；`pnpm vitest run packages/domain` 通过
- [x] 1.3 把 `SessionActor` 外部族收敛为单一写入方法与 design.md Decision 2 的三行策略表，统一结果类型并携带 `environmentInvalidated`；`writeUser` / `writeProbe` 改共用同一前提助手与写入后果处理；`pnpm vitest run packages/terminal-service` 通过且 1.1 基线结果不变
- [x] 1.4 把三处「前提码 → `ExternalErrorCode`」映射合并为 `terminal-service` 内一个实现；`inputWriteError` 增加 `environment-unverified` 显式分支并删除调用方传入的 `environmentInvalidated` 补丁参数；`pnpm vitest run packages/terminal-service` 通过且 1.1 基线结果不变
- [x] 1.5 逐项对照 1.1 基线，确认四条路径的外部错误码与事务状态无一变化，并把对照结论记录到本文件；发现任何变化即停止，修正后再进入第 2 组

## 2. 第二刀：结构化写入不确定态（行为变更）

- [x] 2.1 先在 `packages/terminal-service/src/session/command-executor.test.ts` 写出能判红的用例：写入抛错时以 `EXECUTION_WRITE_UNKNOWN` 失败、不返回可操作 transactionId、environment 被失效且 executionContextId 被轮换；确认该用例当前失败
- [x] 2.2 在 `packages/domain` 的 `ExternalErrorCode` 增加 `EXECUTION_WRITE_UNKNOWN`，并把 `mcp-tools.ts` 与 `external-tool-pipeline.ts` 两份字面重复的稳定错误码集合收为同一常量；`pnpm vitest run packages/mcp-runtime` 通过
- [x] 2.3 实现「写入尝试发起后抛错 → 失效 environment、递增 capability epoch、轮换 executionContextId、返回 `write-unknown`」的统一后果，并让 `CommandExecutor` 的抛错分支改判为 `EXECUTION_WRITE_UNKNOWN`；2.1 的用例转绿且 `pnpm vitest run packages/terminal-service` 通过
- [x] 2.4 补齐 delta spec 的另两个场景用例：写入前失败仍返回既有稳定错误码且不失效 environment；不确定态之后用旧 `expectedContextId` 再次 execute 返回 `EXECUTION_CONTEXT_STALE`；`pnpm vitest run packages/terminal-service` 通过
- [x] 2.5 验证错误码不会被解析路径降级：`synapse_execute` 的 `EXECUTION_WRITE_UNKNOWN` 经 `serializeMcpToolError` 与 `parseStableError` 往返后仍保持稳定码与原因文本；`pnpm vitest run packages/mcp-runtime` 通过

## 3. 术语与决策记录

- [x] 3.1 更新 `CONTEXT.md` 的「事务不确定态」词条，把「写入尝试本身未取得交付确认」纳入定义；`pnpm format:check` 通过
- [x] 3.2 新增 ADR 记录「PTY 写入尝试发起后的失败一律判为不确定态」的取舍与替代方案，在 ADR-0018 中标注接管关系，并更新 `docs/adr/README.md` 索引；`pnpm docs:check` 通过
- [x] 3.3 检查 `docs/architecture/architecture.md` 与 `docs/security/security.md` 是否描述了结构化执行的写入失败语义：需要则同步，不需要则在本文件记录判断依据

## 4. 整体验证

- [x] 4.1 运行 `openspec validate harden-structured-write-uncertainty --strict` 与 `git diff --check`，两者均通过
- [x] 4.2 运行 `pnpm verify`（format:check、docs:check、lint、typecheck、test）并通过
- [x] 4.3 记录本次不运行 `pnpm test:e2e` 与平台/打包冒烟的判断依据（未改 UI、IPC 契约与打包配置），并如实说明实际执行的验证范围

## 第二、三组的实现结论

### `writeFailure` 由公开字段改为私有参数

2.3 落地时发现：本地通道（`writeUser` / `writeProbe`）没有事务可以承载不确定态，写入抛错必须照旧抛给调用方；把它做成 `WriteRequest` 上的公开字段会让「过渡字段」变成一个不必要的公开词汇。改为 `#writeGuarded(request, writeFailure)` 的私有参数：公开的 `writeExternal` 一律 `uncertain`，本地通道传 `propagate`。设计见 design.md Decision 1 与 5。

### 结构化写入不确定态不产出可见事务

`CommandExecutor` 的写入不确定分支复用既有的 `#rejectBeforeSend` 路径：不发出 `started` 事件、不写入历史、清空活动事务，客户端只收到 `EXECUTION_WRITE_UNKNOWN` 错误。这与 delta spec 的 `Structured execute write outcome is unknown` 场景一致，也是 Decision 6 选择该形态的直接后果。

### 文档更新范围超出 3.3 的字面范围

3.3 只点名了 `architecture.md` 与 `security.md`。核对后这两份**不需要改**：`security.md:26` 描述的是「旧上下文必须在 PTY 写入前失效」，本次改动没有改变这条边界；`architecture.md` 不描述结构化执行的写入失败语义。但错误码是外部契约，`docs/reference/mcp-tools.md`（错误码表与 `synapse_execute` 段落）、`docs/guides/troubleshooting.md`、`docs/guides/connect-external-client.md` 三处都列举了不确定态错误码，必须同步，已一并更新。判断依据与改动都记录在此。

### 4.3 验证范围说明

实际执行的验证：

| 检查 | 结果 |
| --- | --- |
| `pnpm verify`（format:check、docs:check、lint、typecheck、test） | 通过；70 个测试文件 / 408 项通过，1 文件 2 项跳过 |
| `pnpm build`（vite main / preload / renderer 三步） | 三步退出码均为 0，产物为新生成 |
| `pnpm test:e2e`（带 `SYNAPSE_TERM_ELECTRON_E2E=1`） | 26/26 通过，含真实 `_electron.launch` 的 `electron-mcp-access.spec.ts`（22.2s，多次调用 `synapse_execute`、`synapse_start_interactive`、`synapse_input`、`synapse_finish_interactive`） |
| `electron-builder --win dir` + `pnpm smoke:packaged-desktop` | 产物生成；冒烟返回 `{"ok":true,"sessions":1,"version":"0.6.1","updater":"idle"}` |
| `openspec validate --strict`、`git diff --check` | 通过 / 干净 |

**打包链上的已知缺口（与本变更无关，属于本机环境）：** `electron-builder.yml` 的 `npmRebuild: true` 会调用 `@electron/rebuild` 用 node-gyp 重编 `node-pty`，需要 Visual Studio 的 C++ 桌面开发工具与 Windows SDK。本机没有该工具链（`vswhere.exe` 不存在、`msbuild` 与 `cl` 不在 PATH、两个 Visual Studio 目录均不存在），因此 `pnpm package:win:dir` 与 `pnpm package:win` 在此环境失败（`Could not find any Visual Studio installation to use`）。这是 `docs/reference/platform-support.md`、`docs/getting-started/install.md`、`docs/development/setup.md` 三处都已写明的前置条件。

上面的打包冒烟是在 `--config.npmRebuild=false` 的**试验性旁路**下产出的产物上执行的。它证明打包应用能启动、能加载 node-pty 并起真实 PTY（node-pty 自带 `prebuilds/win32-x64` 与 `conpty` OpenConsole），**但不等价于验证正式配置**：`npmRebuild: true` 这条路径在本机无法验证，`pnpm test:installer`（NSIS 安装/升级/卸载）与 macOS 打包同样未运行。

**未被任何自动化覆盖的路径：** `EXECUTION_WRITE_UNKNOWN` 本身的触发需要 PTY 写入失败，真实运行无法注入，因此它只在单元/契约测试（`command-executor.test.ts`、`external-write-error-contract.test.ts`）中覆盖。真实 Electron 运行覆盖的是同一改动下的其余外部写入路径与错误映射。

全量测试在 Windows 上会打印 `AttachConsole failed` 与注册表读取失败，来自真实 ConPTY 集成测试的环境噪声，改动前基线同样存在。

## 基线记录（第一组的不变量对照基准）

1.1 建立时全量测试为 `70 passed / 1 skipped`（`388 passed / 2 skipped`）。四条路径的现状外部错误码基线：

| 路径 | 前提失败 | 现状外部错误码 | 覆盖位置 |
| --- | --- | --- | --- |
| 结构化执行 | environment 在写入前失效 | `SESSION_NOT_READY`（`writeError('environment-unverified')`） | `external-write-error-contract.test.ts` |
| 结构化执行 | capability epoch 在写入前变化 | `SESSION_NOT_READY`（`writeError('stale-environment-epoch')`） | 同上 |
| 结构化执行 | executionContextId 在写入前轮换 | `EXECUTION_CONTEXT_STALE` | 同上 |
| 交互启动 | environment / epoch / context 同上三种 | `SESSION_NOT_READY` / `SESSION_NOT_READY` / `EXECUTION_CONTEXT_STALE` | 同上 |
| 事务内输入 | environment 在写入前失效 | `INPUT_WRITE_UNKNOWN` 且事务收敛 `unknown` | 同上 |
| 自由输入 | 写入前 executionContextId 失配 | `EXECUTION_CONTEXT_STALE` | `external-input-error-contract.test.ts` |
| 自由输入 | 写入尝试交付未确认 | `INPUT_WRITE_UNKNOWN` 且 environment 失效、context 轮换 | 同上 |
| 外部写入族 | 已取消 | 五个方法各自返回 `external-write-cancelled` 且不写入 PTY | 同上 |

覆盖范围说明：结构化的 epoch / context 失败靠在 actor 串行队列里先排入一个改变前提的操作再 `execute` 构造；交互启动的同类失败靠先 `start` 再排队（其快照读取发生在自己的队列任务里）。因此断言确实经过映射函数而不是被调用方的前置检查拦下。`已取消` 只在 SessionActor 层面可达——经 executor 时 `run.settled` 已为真，`#dispatch` 会在映射前返回。

### 1.5 对照结论

对照方式：上述基线断言在结构收敛后**逐字未改**，只把调用语法迁移到新的单一写入接口；基线测试本身就是对照基准。

结论：四条路径的外部错误码与事务状态无一变化，证据有三点。

1. 基线断言全部通过，其中包含错误消息前缀（`/^SESSION_NOT_READY:/` 等）与「不写入 PTY」的字节级断言。
2. `write-error-mapping.ts` 的 reason 与 guidance 逐字搬运自原来的三处 switch；新增的 `environment-unverified` 显式分支与原来「`external-write-cancelled` ＋ 调用方 `verificationStatus !== 'verified'` 补丁」产生完全相同的描述，因此事务内输入那一条路径的对外文本也没有变化。
3. 全量测试 `70 passed / 1 skipped`（`404 passed / 2 skipped`），测试文件数与跳过数不变，通过数差额全部来自新增用例（domain 前提表 +3）。

一并确认了三处「预期不变但需要证据」的行为：`writeUser` / `writeProbe` 仍不捕获写入抛错（新接口缺省 `propagate`）；自由输入不轮换 capability epoch（`context` 前提的后果表为「写前失效、不轮换」）；结构化执行在新接口下缺省 `propagate`，其写入抛错仍以调用方异常路径收敛。
