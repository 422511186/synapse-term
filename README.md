# Synapse Term

Synapse Term 是一个本地优先的桌面终端。它管理用户主动创建的 Session，并可通过只监听本机回环地址的内嵌 MCP Server，把用户明确 Sharing 的 Session 提供给本机外部客户端。

[下载最新稳定版](https://github.com/422511186/synapse-term/releases/latest) · [快速开始](docs/getting-started/install.md) · [完整文档](docs/README.md) · [参与贡献](CONTRIBUTING.md)

> [!NOTE]
> 正式安装包目前提供 Windows x64 和 macOS arm64。源码开发需要 Node.js 24 与 pnpm；完整平台要求见[安装说明](docs/getting-started/install.md)。

## 核心能力

- **本地终端工作区**：发现本机 Shell，创建、切换、重命名和关闭多个 Session；在同一个 Session 中进入 SSH、跳板机、容器或 WSL 时，应用仍只管理当前本地 PTY。
- **显式 Sharing**：外部客户端只能操作用户主动 Sharing 的 Session；未共享的 Session 不可见，取消 Sharing 后访问立即失效。
- **受控的 MCP 执行**：外部调用经过执行上下文校验、风险分类、审批模式和输出脱敏；结构化命令与需要 stdin 的交互事务使用不同协议。
- **清晰的本地边界**：应用不提供账号体系、远程主机资产、凭据库或集中审计日志，也不跨应用重启持久化 Session 和终端输出。

Synapse Term 不运行模型，也不负责 Provider、ACP 或远程凭据管理；外部客户端通过 MCP 使用用户明确 Sharing 的 Session，本地终端控制权始终属于用户。

## 五分钟开始

1. 从 [GitHub Releases](https://github.com/422511186/synapse-term/releases/latest) 下载适合当前平台的安装包并启动应用。
2. 点击「新建终端会话」，选择系统发现的 Shell，开始使用 Session。SSH、容器或其他认证流程直接在终端内完成。
3. 需要让外部客户端协助操作时，在「设置」→「MCP 服务」启用端点并配置 Token，再从目标 Session 的菜单选择「共享到 MCP」。

首次安装、macOS Gatekeeper 提示和源码运行方式见[安装说明](docs/getting-started/install.md)。完整 Sharing 流程见[首次共享 Session](docs/getting-started/share-a-session.md)。

## 安全边界

- Renderer 只能通过受限 preload API 使用 Electron Main 持有的能力，不能直接访问 Node API、PTY 或 Session 内部状态。
- 内嵌 MCP Server 默认关闭，只绑定 `127.0.0.1`，并要求 Bearer Token。
- Sharing 输出从 Sharing 建立后开始，不回放之前的内容；对外提供的是清理、脱敏后的有限输出历史，不是屏幕快照或原始 PTY 字节流。
- `full` 审批模式会自动放行高风险外部执行，但不会绕过输出脱敏；只应在可恢复的隔离环境中使用。

完整威胁边界和信任假设见[安全边界](docs/security/security.md)。

## 从源码开发

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
pnpm build
pnpm start
```

`pnpm dev` 只启动带 Mock API 的浏览器 Renderer，不会创建真实 PTY。开发环境、测试矩阵和打包前提见[开发指南](docs/development/setup.md)。

## 文档入口

- [安装与首次启动](docs/getting-started/install.md)
- [创建第一个 Session](docs/getting-started/first-session.md)
- [连接外部客户端](docs/guides/connect-external-client.md)
- [MCP 工具参考](docs/reference/mcp-tools.md)
- [架构说明](docs/architecture/architecture.md)
- [文档总览](docs/README.md)

## 许可证

本项目基于 [MIT License](LICENSE) 发布。
