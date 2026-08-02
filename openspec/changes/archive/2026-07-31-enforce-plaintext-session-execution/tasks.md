## 1. 执行契约与入口盘点

- [x] 1.1 固化受支持的当前环境矩阵（POSIX 能力集合、PowerShell 版本、`windows | unix | unknown` platform 分类、PTY 明文块大小和换行规则），并将最终取舍同步到 `design.md` 与 delta specs。
- [x] 1.2 盘点并登记生产执行入口：`SessionActor` Agent/User PTY 写入、`ShellProbe`、`CommandExecutor`、`SessionResourceService`、`node-pty` spawn、`reg.exe`、`taskkill.exe` 和 Core IPC 子进程；为每个入口标注 `plaintext_shell`、`user_input`、`direct_argv` 或 `data_encoding`。
- [x] 1.3 以失败测试建立静态执行门禁，扫描生产执行模块中的 `base64 -d`、`FromBase64String`、`EncodedCommand`、`ScriptBlock::Create`、`Invoke-Expression`、编码载荷后 `eval` 及等价组合，并允许认证/日志/结果序列化中的非执行编码例外。
- [x] 1.4 定义 domain/protocol 的 `ExecutionEnvironment`、验证状态、environment epoch、transport mode、source kind 和稳定错误码（包括 `execution_environment_unverified`、`command_not_auditable`、`plaintext_protocol_error`），先补充 schema 与迁移失败测试。

## 2. 当前 PTY 环境识别

- [x] 2.1 扩展 Fake PTY 与 Session 测试夹具，捕获每次原始写入、重组写入文本、Lease epoch、environment epoch 和审计事件，支持模拟 SSH、容器和嵌套 Shell 的输出。
- [x] 2.2 以失败测试定义首次结构化执行、人工输入后重新验证、User Takeover、PTY 重连、PowerShell -> POSIX、POSIX -> PowerShell、歧义和超时场景；确认普通对话与 `terminal_observe` 不写 Probe。
- [x] 2.3 实现固定明文、无副作用的跨方言环境指纹解析，返回当前 dialect/platform 候选并拒绝歧义输出；不得通过依次注入两套完整 Shell wrapper 猜测方言。
- [x] 2.4 将 environment capability 状态接入 `SessionActor`、Session 持久化、Core API/IPC 和 Renderer summary；启动方言只保存为 unverified hint，旧 Session 读取后不得直接变为 verified。
- [x] 2.5 实现 capability epoch 失效与并发保护：用户输入、接管、交互状态、PTY 边界或旧 Agent token 必须使旧 environment 验证和 pending dispatch 失效。
- [x] 2.6 增加当前环境状态和 `observation-only`/未验证拒绝原因的中文 UI 映射与显示测试，确保手动选择只改变候选而不能绕过验证。

## 3. 明文 ShellDriver 与 PTY writer

- [x] 3.1 先以失败单元测试定义 POSIX 明文 brace transaction：原始命令可见、状态在当前 Shell 保留、OSC 777/可读完成标记匹配 nonce、非零退出可观测、多行/Unicode/语法边界和长单行行为。
- [x] 3.2 先以失败单元测试定义 PowerShell 明文 dot-sourced transaction：原始命令可见、`Set-Location`/变量状态保留、对象输出与异常退出保持现有语义、完成事件匹配 nonce，且不出现编码动态执行 API。
- [x] 3.3 重写 `PosixShellDriver` 和 `PowerShellDriver` 的 wrapper 构造，移除 Base64 赋值、解码器、`eval`、`FromBase64String` 和 `ScriptBlock::Create`，加入 nonce/分隔符/控制字符校验与 `command_not_auditable` 失败路径。
- [x] 3.4 实现有界 plaintext PTY writer：按可配置安全块大小传输原始字符串，保持 Unicode code point、行顺序和 CR/LF 语义，不在块边界插入编码字符或提前提交多行脚本。
- [x] 3.5 更新 `shellInputLines`、完成事件解析和 Probe/Command 的写入等待逻辑，使明文多行事务只在完整外围块结束后执行，并覆盖写入拒绝、超时、PTY exit 和交互中断。
- [x] 3.6 更新 shell-driver、probe 和 command executor 相关旧测试，删除“解码后检查内容”的断言，改为捕获 PTY 输入并断言原命令存在、禁止载荷/解码器不存在。

## 4. 统一 Agent Shell Dispatch

- [x] 4.1 以失败集成测试证明 `terminal_execute`、Shell Probe 和 Session Resource 刷新都必须经过同一 dispatch，并证明任意直接 Agent PTY write 会被拒绝且没有副作用。
- [x] 4.2 实现 `PlaintextShellDispatcher` 及其强类型输入/输出，集中执行 environment、Lease、审批、命令哈希、source kind、wrapper 构造、明文检查、分片和审计 attestation。
- [x] 4.3 收紧 `SessionActor` 低层 Agent 写入能力，区分用户原始输入与经 dispatch 授权的 Agent plaintext source；更新 `ShellProbe` 先做环境验证再运行当前 dialect Probe。
- [x] 4.4 更新 `CommandExecutor` 使用已验证 environment epoch 和 dispatcher 返回的 source，保证审批绑定的原始命令与实际 PTY source 一致，过期 epoch 在写入前失败。
- [x] 4.5 更新 `SessionResourceService`/`session-resource-parser` 通过统一 dispatcher 运行固定资源脚本；保留的数据 Base64 只能序列化字段，增加测试证明不会进入任何代码执行路径。
- [x] 4.6 将稳定错误映射接入 ToolGateway、Core request router、资源刷新结果和 Agent Runtime；模型收到可恢复错误时不得被伪造为成功完成，Session 保持可观察/可接管。

## 5. 审计与安全边界

- [x] 5.1 先以失败测试定义每次结构化执行的 transport attestation：source kind、transport mode、dialect/platform、environment epoch、command hash、Lease/Grant、时间、结果和拒绝原因，并覆盖 Protected Input 不落长期审计。
- [x] 5.2 扩展 `audit-service`、持久化 schema、Timeline/审计查询和协议类型，兼容读取旧事件并为旧记录标记 transport/environment 未知，不回填虚假的 verified 状态。
- [x] 5.3 将明文 dispatch 拒绝、环境指纹失败、静态门禁违规和缺失完成证据接入 fail-closed 审计；确认拒绝路径不写入 Agent payload、不重试旧 Base64 wrapper。
- [x] 5.4 复核 Permission Mode、Approval Grant 和风险分类调用链，确保策略使用执行时已验证 dialect，完整命令哈希在 wrapper 构造前后保持一致，模式切换不能升级活动授权。
- [x] 5.5 增加全仓库生产执行入口回归测试，确认 `node-pty`/维护子进程使用显式 executable+argv，认证/日志/结果编码没有调用 Shell 执行器。

## 6. 跨平台与真实链路验证

- [x] 6.1 使用 Fake PTY 集成测试覆盖本地 PowerShell 人工 SSH 到 POSIX、POSIX 人工进入 PowerShell、容器/堡垒机提示、用户接管和重新验证；断言绝不向当前环境写入另一方言 wrapper。
- [x] 6.2 在真实 Bash/Git Bash PTY 中验证明文 Probe、命令输出、非零退出、`cd`/变量状态、持续输出、Ctrl+C、长 Unicode 和服务器输入捕获。
- [x] 6.3 在真实 PowerShell/ConPTY 中验证明文 Probe、`Set-Location`/变量状态、对象输出、异常、持续输出、Ctrl+C、交互接管和服务器输入捕获。
- [x] 6.4 覆盖首次执行、epoch 失效、资源刷新、超时、Shell 丢失、语法不支持和审计失败的 Core/ToolGateway/packaged Electron 流程，确认所有失败均不产生隐藏执行。
- [x] 6.5 在不修改真实远端数据的 SSH/堡垒机验收夹具中检查会话录像/输入日志能直接看到原始命令与事务边界，并将证据加入验证矩阵；缺少合规日志时保持 observation-only。

## 7. 迁移、文档与发布验证

- [x] 7.1 实现数据库/仓储迁移：旧 Session 的启动 dialect 作为 unverified hint，活动旧事务和 Core 重启状态正确标记 `interrupted`，新增字段有默认值和向后读取策略。
- [x] 7.2 更新 README、安全边界、运行手册、错误文案和开发者指南，明确服务器明文审计要求、SSH/容器环境验证、非执行 Base64 例外和 observation-only 降级。
- [x] 7.3 运行 `pnpm format:check`、lint、typecheck、目标 Vitest、Core 集成、真实 Shell/ConPTY（按平台条件）和 Playwright/packaged 测试，修复协议/审计/布局回归。
- [x] 7.4 运行 `openspec validate enforce-plaintext-session-execution --strict`、`openspec validate --all --strict` 和生产执行静态门禁，确认所有 delta requirement 有测试或人工证据。
- [x] 7.5 完成代码审查与发布报告，记录明文 PTY 捕获样本、跨平台环境矩阵、拒绝/回滚策略、残余风险，并确认回滚不会重新启用不可审计 Agent 执行。

## 8. SSH/PTY 真实链路修复

- [x] 8.1 先增加失败测试，覆盖 POSIX/PowerShell 单行事务、带换行或注释的保守回退、CR/LF 物理行分派，以及资源刷新不再生成超长单条 PTY 输入。
- [x] 8.2 实现单行明文 transaction envelope 和统一物理行 writer，保持原始命令可见、当前 Shell 状态和完成事件语义。
- [x] 8.3 将 POSIX/PowerShell 资源采集拆为受控长度的固定只读命令序列，Collector 在同一 Lease/epoch 下顺序汇总并使用总超时。
- [x] 8.4 运行单元、Core 集成、真实 POSIX PTY、静态门禁和 OpenSpec 严格验证；记录 macOS 本地 PTY/Node 运行时条件与真实 SSH 验收边界。
- [x] 8.5 回补统一 Dispatcher 的唯一 Agent PTY 写入边界：静态门禁只允许 `plaintext-dispatcher.ts` 调用低层 Agent 写入；`CommandExecutor` 在注册输出监听后经 Dispatcher 写入；Probe 只能经固定的指纹/能力 API 写入。
