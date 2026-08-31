## Why

当前字面执行只依据 Session 启动时的 Shell 类型选择 Shell Driver；用户通过 SSH、跳板机、容器或 WSL 进入另一种 Shell 后，完成探针可能使用错误方言。与此同时，完成探针的本地输入回显是否隐藏只能由实现决定，用户无法在通用设置中选择诊断可见性，也容易误以为隐藏 UI 回显等于远程不发送探针。

现在需要把 `develop` 已验证的当前 PTY 环境识别与 capability epoch 机制恢复到内嵌 MCP Server 的字面执行路径，并将完成探针的本地终端回显作为明确、持久化且有安全说明的通用设置项。

## What Changes

- **BREAKING** 外部结构化执行不得再把 Session 启动时的 `terminalType` 当作当前 Shell 方言事实；执行前必须使用当前 PTY 的已验证环境上下文选择 Shell Driver，环境未知或歧义时拒绝执行。
- 在 Session 环境中恢复当前 PTY 的 dialect、platform、验证状态、验证时间和 capability epoch；用户输入、Shell 接管、SSH/容器/WSL 等可能改变当前环境的行为使旧环境失效。
- 复用 `develop` 的有界、固定、带 nonce 的环境指纹 Probe 和 lease/epoch 校验，不创建 SSH 主机、跳板机或容器拓扑模型；字面用户命令发送仍保持 `literal-shell-audit` 的原文边界。
- 将外部执行的写入路径与本地用户输入路径区分开：本地输入可以使环境失效，经过租约和当前 epoch 验证的外部调用不得错误地把自身写入标记为用户接管。
- 在“通用”设置中增加“隐藏完成探针回显”开关，默认开启；关闭只允许诊断时显示本地终端回显，不改变 PTY 实际输入、远程服务器可见性、事务完成检测、退出码或 MCP 输出脱敏。
- Renderer 通过受限 preload API 读取和更新该设置，Main 负责持久化并将设置应用于本地终端显示链路；控制帧隔离和外部客户端返回输出继续独立生效。
- 增加跨 SSH 方言切换、环境失效、Probe 超时、租约竞态、设置持久化和 UI/Mock/真实 Electron 回归测试。

## Capabilities

### New Capabilities

- `current-pty-environment`: 定义当前 PTY 环境验证、Shell 方言选择、capability epoch 失效和跨 SSH/容器/WSL 后的安全执行边界。
- `probe-visibility-settings`: 定义完成探针本地终端回显可见性设置、默认值、持久化、受限 IPC 访问和不影响远程 PTY/事务语义的边界。

### Modified Capabilities

<!-- 当前仓库没有可直接修改的主规格；已完成 Change 的 delta 不在本变更中重写。 -->

## Impact

- `packages/domain/`：扩展当前 PTY 环境与 capability epoch 的公共领域类型和状态转换。
- `packages/terminal-service/`：恢复 ShellProbe、动态环境验证、外部租约写入边界，并让字面 CommandExecutor 使用已验证 dialect。
- `apps/desktop/src/main/`：接入环境验证、设置持久化和终端输出显示策略；保持 Renderer 不直接接触 PTY 或 Session 内部状态。
- `apps/desktop/src/preload/`、`apps/desktop/src/shared/`：增加受限设置 API、IPC 通道和契约测试。
- `apps/desktop/src/renderer/`：在“通用”设置区增加开关、说明和 Mock 行为。
- 测试：补充 fake backend、Shell/Session 集成、MCP 外部调用、设置 UI、Playwright 和可用的真实 ConPTY 覆盖。
- 不新增远程服务、账户、凭据、持久化 Session 或 SSH/服务器拓扑；探针仍可能被目标 Shell/SSH/终端审计设施记录，设置只控制本地终端 UI 回显。
