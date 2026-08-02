## 1. 工程基线与技术 Spike

- [x] 1.1 初始化 pnpm TypeScript monorepo，建立 `apps/desktop`、`apps/core`、`packages/domain`、`packages/protocol` 和 `packages/test-kit`。
- [x] 1.2 配置 TypeScript strict、ESLint、Prettier、Vitest、Playwright、覆盖率和统一 `pnpm` 验证脚本。
- [x] 1.3 建立独立 Node.js 24.12 Core Runtime 打包 Spike，验证 `node-pty`、`node:sqlite`、`web-tree-sitter`、Bash WASM grammar 和 `@napi-rs/keyring` 在 Windows x64 加载。
- [x] 1.4 建立 Command Protocol Spike，验证 POSIX 引号、多行、here-doc、`cd`、`export`、管道、`set -e`、`exit`、`exec`、trap 和 OSC 777。
- [x] 1.5 记录 Spike 结果并更新 OpenSpec design/tasks；若能力边界变化，创建独立 follow-up change 而不是静默降级。

## 2. 共享领域模型与 IPC 协议

- [x] 2.1 以失败测试先定义 Session、Lease、Agent Task、Command Transaction、Approval Grant 和 Provider Profile 领域类型及状态转换。
- [x] 2.2 实现共享 Zod Schema、稳定错误码、事件 envelope 和协议版本模型。
- [x] 2.3 以失败测试实现长度前缀 IPC framing、增量解码、二进制 terminal-output frame 和背压边界。
- [x] 2.4 实现 IPC handshake、challenge、认证令牌、协议兼容检查和 request/response/event correlation。
- [x] 2.5 建立 fake clock、fake PTY、fake Provider、临时数据目录和事件断言测试工具。

## 3. Terminal Core 生命周期与持久层

- [x] 3.1 以失败测试实现 Core 单实例、用户作用域 Named Pipe、启动锁和干净关闭。
- [x] 3.2 实现 Electron Main 启动/发现独立 Core、重连、版本冲突和退出选择协议。
- [x] 3.3 建立 `node:sqlite` 仓储适配器、schema version、WAL、迁移、启动备份和事务封装。
- [x] 3.4 实现 Session、Agent Task、Command Transaction、Approval Grant、Provider Profile 和 Audit Event 仓储。
- [x] 3.5 实现应用数据目录 ACL、认证令牌持久化和原始日志目录管理。

## 4. PTY、SessionActor 与输出恢复

- [x] 4.1 以失败测试实现 `PtyAdapter` 接口和 `node-pty` Windows ConPTY 适配器，包括 spawn、write、resize、Ctrl+C 和 exit。
- [x] 4.2 以失败测试实现 `SessionActor` 串行事件队列、正交状态和 Lease epoch 失效规则。
- [x] 4.3 实现 SessionManager、启动配置、默认 20 Session 限制和资源错误。
- [x] 4.4 实现 `@xterm/headless` TerminalModel、10,000 行滚动区和 OSC handler 注册。
- [x] 4.5 以失败测试实现 OutputJournal sequence、批量落盘、每 Session/全局容量限制和消费者游标。
- [x] 4.6 实现 serialize snapshot、增量 replay、`history_gap` 和 UI attachment 重连。
- [x] 4.7 实现 UI detach、显式终止、最后 Session 结束后的 Core 延迟退出和 Core 重启 `interrupted` 恢复。
- [x] 4.8 实现原始日志 24 小时、审计 30 天默认留存及可配置清理任务。

## 5. ShellProbe 与 Command Transaction

- [x] 5.1 以性质测试实现 POSIX 单引号编码和原始命令到包装协议的确定性转换。
- [x] 5.2 实现 ShellProbe、shell capability epoch、OSC 777 nonce 协议和 probe 失败 observation-only 模式。
- [x] 5.3 以失败测试实现 Command Transaction 状态机、单 Session 单事务和确定退出码规则。
- [x] 5.4 实现 `observationWindow`、`terminal.wait`、hard deadline 告警和运行中状态。
- [x] 5.5 实现 CommandOutputCollector、ANSI/控制帧处理、重复进度行归一化、输出 cursor 和大小上限。
- [x] 5.6 实现 alternate screen、密码、确认、pager、editor 和复杂光标交互检测。
- [x] 5.7 实现 User Takeover、人工输入后重新 Probe、Agent 取消与命令中断的独立语义。
- [x] 5.8 使用 Git Bash 与 fake PTY 覆盖正常完成、失败退出、缺失 OSC、Shell 退出、大输出、UTF-8 和 Ctrl+C 集成测试。

## 6. PolicyEngine、授权、敏感数据与审计

- [x] 6.1 以失败测试集成 `web-tree-sitter` 与 Bash WASM grammar，解析命令、pipeline、substitution 和 redirection。
- [x] 6.2 实现保守只读命令/参数规则、alias/function override 检查和 unknown fail-closed 分类。
- [x] 6.3 以失败测试实现精确命令 Approval Grant、哈希、顺序绑定、Session 绑定和任何编辑失效。
- [x] 6.4 实现 read-only、unknown、mutating、privileged、destructive 风险层级及高危二次确认。
- [x] 6.5 实现 Protected Input 状态，使密码按键不进入模型、输入日志或审计 payload。
- [x] 6.6 实现可配置 secret detectors、模型披露脱敏和本地终端原始显示分离。
- [x] 6.7 实现追加式结构化 Audit Event、审计查询和关键状态转移覆盖测试。
- [x] 6.8 完成跨 Windows 用户 Pipe 访问、Renderer 绕过和策略内部错误的安全测试。

## 7. Provider Profile 与模型协议适配

- [x] 7.1 以失败测试实现 Provider Profile CRUD、Zod 校验和任务引用完整性。
- [x] 7.2 实现 `@napi-rs/keyring` SecretStore，确保密钥不进入 SQLite、日志或 Renderer。
- [x] 7.3 定义统一 `ModelEvent` 与 `ModelAdapter`，并建立流式 fixture 契约测试框架。
- [x] 7.4 实现 OpenAI Responses Adapter 的 streaming、Tool Call、usage、取消和错误归一化。
- [x] 7.5 实现 OpenAI-compatible Chat Completions Adapter 和自定义 base URL/header。
- [x] 7.6 实现 Anthropic Messages Adapter 的 streaming、Tool Use、usage、取消和错误归一化。
- [x] 7.7 实现 Provider 连接、鉴权、streaming、Tool Call 能力探测和 Profile 可用性状态。
- [x] 7.8 实现首事件前有界重试、流开始后禁止隐式重试及对应契约测试。

## 8. AgentRuntime 与 Terminal Tool

- [x] 8.1 以失败测试实现 Agent Task 状态机、每 Session 单任务和全局 4 Task 调度器。
- [x] 8.2 实现 ContextBuilder 的显式上下文披露、有限回滚、任务摘要、脱敏和 token/output 预算。
- [x] 8.3 实现 `terminal.observe`、`terminal.execute`、`terminal.wait` 和 `terminal.interrupt` Tool Schema 与 ToolGateway。
- [x] 8.4 实现模型 Tool Call 增量组装、完整 Schema 校验和同一 Session 多 Tool Call 顺序执行。
- [x] 8.5 实现 PolicyEngine、Approval Manager、Session Lease 和 CommandExecutor 的端到端编排。
- [x] 8.6 实现 UI 断开后当前命令完成再 suspended、Provider 中断和 User Takeover 恢复流程。
- [x] 8.7 使用 fake Provider 完成自然语言只读目标、变更授权、交互接管、取消和失败恢复集成测试。

## 9. Electron 桌面终端

- [x] 9.1 搭建 Electron Main、sandboxed Renderer、React 和窄 preload API，验证 `nodeIntegration` 关闭。
- [x] 9.2 实现启动配置、Session 标签页、创建/关闭/切换和状态指示。
- [x] 9.3 集成 `@xterm/xterm`，实现输入、复制粘贴、scrollback、搜索、fit/resize 和输出批处理。
- [x] 9.4 实现 Core 连接、sequence ack、增量 replay、snapshot restore、`history_gap` 和版本冲突 UI。
- [x] 9.5 实现 Session-scoped Agent 面板、自然语言输入、任务时间线和流式模型文本。
- [x] 9.6 实现精确命令审批、风险展示、高危二次确认、拒绝、取消、中断和 User Takeover 控件。
- [x] 9.7 实现 Provider Profile 设置、能力测试、Credential Manager 写入和错误反馈。
- [x] 9.8 实现日志/审计查看、清理设置、Core 后台状态和显式退出选择。
- [x] 9.9 完成键盘可达性、最小窗口布局、长命令换行、错误状态和文本不重叠检查。

## 10. 端到端、性能、安全与打包

- [x] 10.1 在真实 Windows ConPTY 中验证 PowerShell 人工终端和 Git Bash POSIX Agent 执行工作流。
- [x] 10.2 使用 Playwright 覆盖 Session 创建、Agent 只读执行、命令审批、User Takeover、UI 重连和错误状态。
- [x] 10.3 采集桌面和最小窗口截图，检查终端非空、控件可见、文本换行和无重叠。
- [x] 10.4 执行 20 个空闲 Session、4 个并发 Agent Task、持续高输出和慢消费者压力测试并修复无界增长。
- [x] 10.5 执行敏感输入、Token 脱敏、跨用户 IPC、stale lease、授权篡改和 Renderer 隔离安全测试。
- [x] 10.6 构建 Windows 安装包，验证独立 Node Runtime、全部原生模块、首次启动、后台 Core 和卸载清理。
- [x] 10.7 实现升级前活动 Session 提示、数据库备份、版本兼容检查和可验证回滚流程。
- [x] 10.8 编写 README、架构运行说明、Provider 配置、风险边界、开发验证和故障排查文档。

## 11. 完成审计与发布准备

- [x] 11.1 建立每条 OpenSpec Requirement 到自动化测试或人工验证证据的追踪矩阵。
- [x] 11.2 运行 format、lint、typecheck、unit、integration、Playwright、security、performance 和 packaging 全套验证。
- [x] 11.3 运行 `openspec validate build-terminal-agent-mvp --strict`，修复所有 placeholder、矛盾、歧义和未覆盖要求。
- [x] 11.4 确认全部任务勾选、delta specs 可安全同步、Git 工作区可追溯，并生成归档就绪报告。
