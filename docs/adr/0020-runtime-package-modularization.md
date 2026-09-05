# ADR-0020：Runtime implementation 下沉到 workspace packages

状态：已接受

## 背景

`apps/desktop` 曾同时承载 Electron 装配、Session 运行行为和完整的 MCP implementation。这样使 Electron Main 成为业务知识的集中位置，也让未来的 TUI 或本地 Web renderer 只能复制 Main 内部代码，无法复用已有行为。

## 决策

新增两个有明确 interface 的 runtime package：

- `@synapse-term/session-runtime`：承载 Session 生命周期、Shell 环境发现、启动默认值、Session 摘要和有序 PTY 输出事件映射。
- `@synapse-term/mcp-runtime`：承载 Sharing、外部事务、风险分类、审批协调、输入授权、输出历史、脱敏、工具注册、MCP Controller 和本机内嵌 Node MCP Server。

依赖方向保持从上层指向下层：

```text
domain
   ^
terminal-service
   ^                 ^
session-runtime     mcp-runtime
   ^                 ^
        apps/desktop
```

`session-runtime` 和 `mcp-runtime` 只能通过 `domain`、`terminal-service` 的公共出口使用下层能力；任何 package 都不得 import `apps/desktop` 或另一个 package 的内部实现路径。两个 runtime package 的 `src/index.ts` 是外部 seam，只暴露 composition root、运行端契约和装配所需类型。策略、Sharing history、脱敏和输入编码留在 `mcp-runtime` 的内部 seam。

Electron Main 仍是唯一 Composition Root，并继续持有 PTY 与 Session 的 runtime 实例。它负责：

- 创建和连接 `SessionRuntime`、`McpController`、`EmbeddedMcpServer` 与 PTY；
- 通过 Desktop IPC Adapter 做 channel 分发、参数校验和错误转发；
- 注册 preload/IPC、BrowserWindow 生命周期和 Renderer 事件广播；
- 在应用退出时清理 Session、Sharing、审批和 MCP endpoint。

Session runtime 不知道 Electron、IPC 或 MCP；MCP runtime 不知道 Electron，并保留当前 `SessionActor` concrete seam。暂不引入跨进程或远程 Session port，直到出现第二个真实 Adapter 再重新评估 interface。

## 保持不变的语义

本次只改变 implementation 的归属，不改变：

- Electron Main 持有 PTY/Session、Renderer 只能通过受限 preload API 访问的隔离要求；
- Session 对 SSH、跳板机、容器和 WSL 的传输无关语义；
- 显式 Sharing、Sharing 输出边界、输出脱敏和不持久化约束；
- 三档审批模式、审批卡片、会话内放行和超时拒绝；
- 八个 `synapse_*` 工具、executionContextId、外部事务和交互输入授权语义。

## 理由

两个 package 都是有深度的 Module：调用方只需要了解 Session 或 MCP 的小 interface，复杂的生命周期、并发、策略和清理行为集中在一个 locality 内。Desktop 只承担 Electron-specific Adapter 和 Composition Root，未来 TUI 可以直接装配 runtime package，本地 Web renderer 也可以在确定 transport 后复用运行端契约，而不获得 Node、PTY 或 Session 内部状态。

不保留原 `TerminalHost` 或 `apps/desktop/src/main/mcp` 的 re-export shim。保留一个几乎等同于旧 implementation 的转发 Module 会增加 shallow interface，却不能减少调用方知识或维护成本。

## 后果

- package 的单元/集成测试随 implementation 迁移，package public interface 成为主要测试 surface；
- Desktop 构建需要显式依赖两个 runtime package，workspace lockfile 和依赖方向测试必须同步维护；
- `mcp-runtime` 包含 Node HTTP 和文件系统 implementation，浏览器 renderer 不应直接导入其 Node entry；未来需要 browser-safe 子路径时另行设计；
- Session、凭据和审计数据仍只在应用运行期内存或既有本机设置位置存在，不因 package 拆分而新增持久化或远程能力。
