# Synapse Term

Synapse Term 是一个本地优先的 Electron 桌面终端。它管理用户在本机准备的 Shell、SSH、跳板机、容器或 WSL 终端会话，并可通过仅监听本机回环地址的内嵌 MCP Server，把用户明确共享的会话提供给本机外部客户端。

当前版本为 `0.5.1`。产品保持单用户、本地运行边界：Session 和 PTY 只在应用运行期间存在；不提供账号体系、远程主机资产或凭据库，Session 不跨应用重启持久化。

## 能力概览

### 终端工作区

- Electron + React + xterm 桌面端，支持 Windows 和 macOS。
- 自动发现可用 Shell，创建、切换、重命名和关闭多个 Terminal Session。
- 全部会话搜索、终端输出查找、复制、粘贴、滚动和窗口自适应。
- Session 由 Electron Main 进程持有 PTY 和实时输出，Renderer 只能通过受限 preload API 访问。
- 通用设置支持终端诊断显示；外观设置支持主题模式和终端配色。

### 内嵌 MCP Server

- MCP Server 默认关闭，只绑定 `127.0.0.1`，通过 `Authorization: Bearer <Token>` 鉴权。
- 用户必须在桌面端显式共享某个 Session；未共享的 Session 对外部客户端不可见，取消共享立即失效。
- 共享对话框会生成不含 Token 的 Share Text，帮助外部客户端只操作指定 Session。
- 提供八个 `synapse_*` 工具：
  - 观察与状态：`synapse_status`、`synapse_observe`
  - 结构化执行：`synapse_execute`、`synapse_wait`、`synapse_interrupt`
  - 交互事务：`synapse_start_interactive`、`synapse_input`、`synapse_finish_interactive`
- 支持 `read_only`、`managed`、`full` 三档审批模式；高风险调用可进入桌面审批卡片。
- Sharing 输出从共享时刻开始记录，按游标分页读取并经过清理、脱敏；不提供屏幕快照、原始 PTY 字节流或持久化回放。

Synapse Term 本身不是 Agent 运行时，也不负责模型、Provider、ACP 或远程凭据管理。外部客户端（例如 Codex）通过 MCP 连接后，仍由用户掌握本地终端和共享范围。

## 快速开始

### 环境要求

- Windows 或 macOS
- Node.js `>=24.12.0 <25`
- pnpm `10.28.1`（以根目录 `package.json` 的 `packageManager` 为准）

### 安装依赖

```bash
corepack enable
pnpm install --frozen-lockfile
```

### 浏览器 Mock UI

```bash
pnpm dev
```

`pnpm dev` 只启动带 Mock API 的 Renderer，适合 UI 开发和交互验证；它不会启动 Electron、PTY 或真实 Shell。

### 启动真实桌面端

```bash
pnpm build
pnpm start
```

启动后点击 Header 的「+」创建 Terminal Session，选择系统发现的 Shell。Session 默认从当前用户主目录启动；SSH、跳板机、`docker exec`、WSL 或其他认证流程由用户直接在终端内完成。

## 连接外部客户端

1. 打开「设置」→「MCP 服务」，启用本机 MCP 端点并生成访问 Token。
2. 在设置页复制服务地址和 `Authorization` 请求头。默认地址为 `http://127.0.0.1:4739/mcp`，端口可修改。
3. 在目标 Terminal Session 的操作菜单中选择「共享到 MCP」，复制 Share Text 或裸 `sessionId`。
4. 将服务地址、请求头和 Share Text 提供给外部客户端。首次操作前，客户端必须先调用 `synapse_observe` 获取当前输出和 `executionContextId`。
5. 普通命令使用 `synapse_execute` → `synapse_wait`；需要 stdin 的程序（例如 `sudo`、`ssh`、编辑器或 REPL）使用 `synapse_start_interactive` → `synapse_input` → `synapse_finish_interactive`。

安全边界：MCP 服务只接受本机回环连接；Token 不写入 Share Text。共享前产生的输出不会对外回放，取消共享或 Session 退出后外部调用立即失效。`full` 模式会自动放行高风险执行，只应在可恢复的隔离环境中使用。

## 常用命令

| 命令                          | 用途                                    |
| ----------------------------- | --------------------------------------- |
| `pnpm verify`                 | Prettier、ESLint、TypeScript 和 Vitest  |
| `pnpm test`                   | 运行单元、集成和协议测试                |
| `pnpm test:e2e`               | 运行 Playwright 浏览器 E2E              |
| `pnpm build`                  | 构建 Electron Main、preload 和 Renderer |
| `pnpm package:mac`            | 构建 macOS DMG                          |
| `pnpm package:win`            | 构建 Windows NSIS 安装包                |
| `pnpm smoke:packaged-desktop` | 对已打包应用执行真实 PTY 冒烟           |

更完整的开发、测试和发布说明见 [文档总览](docs/README.md)。

## 架构

```text
React Renderer + xterm
        | 受限 preload API
        v
Electron Main
   ├─ Composition Root
   │    ├─ @synapse-term/session-runtime：PTY / Session 行为
   │    ├─ Desktop IPC Adapter
   │    └─ @synapse-term/mcp-runtime（可选，仅监听 127.0.0.1）
   │         ├─ Sharing 与输出边界
   │         ├─ 审批策略与审批卡片
   │         └─ synapse_* 工具管线
```

仓库是 pnpm workspace monorepo：

- `apps/desktop/`：Electron Main、preload、React Renderer 和 E2E。
- `packages/domain/`：Session、终端抽象和外部调用领域模型。
- `packages/terminal-service/`：PTY 适配、SessionActor/Manager、Shell 发现、执行与输出处理。
- `packages/session-runtime/`：Session 生命周期、环境发现、启动默认值和输出事件映射。
- `packages/mcp-runtime/`：Sharing、MCP 外部事务、审批/输入授权和内嵌 MCP Server。
- `packages/test-kit/`：Fake PTY 和测试替身。
- `docs/`：架构、安全与工程文档；`openspec/`：规格变更提案与归档。

Renderer 不直接持有 Node API、PTY 或 Session 内部状态；Electron Main 只负责选择并装配 runtime package、IPC adapter 和窗口生命周期，并在应用退出时终止全部 Session。进入 SSH、容器或 WSL 后，应用仍只管理同一个本地 PTY，不解析远程连接拓扑。

## 文档

- [文档总览](docs/README.md)
- [架构说明](docs/architecture/architecture.md)
- [安全边界](docs/security/security.md)
- [运行手册](docs/engineering/runbook.md)
- [测试指南与验证矩阵](docs/engineering/testing.md)
- [编码与 Git 约定](docs/engineering/conventions.md)
- [Release 发布说明流程](docs/engineering/release.md)

## 许可证

本项目基于 MIT 许可证发布，详见 [LICENSE](LICENSE)。
