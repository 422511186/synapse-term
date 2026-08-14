# Synapse Term

Synapse Term 是一个本地优先的桌面终端。用户在终端中自行准备本地 Shell、SSH、跳板机、容器或 WSL 环境，应用只负责管理 PTY、Session 与实时输出。

当前版本为纯终端裁剪版：内置 Agent、ACP、MCP、审计、Provider/Model 配置和资源监控已移除，后续按新架构重新规划实现。

## 能力概览

- 本地 Electron 桌面端：React、xterm 与简体中文工作区。
- Electron Main 单进程持有 PTY、Session 与实时输出，无独立 Core 进程。
- 多 Session：新建、切换、重命名、关闭、全部会话搜索。
- 终端内查找、复制、粘贴、滚动与窗口自适应。
- 单页设置工作区（占位），为后续设置主题预留入口。
- 浏览器 Mock 开发模式与终端核心单元测试。

Synapse Term 不建立服务器资产、SSH 拓扑或远程凭据模型。用户在终端里如何到达目标环境，不会改变应用边界。

## 快速开始

开发环境要求：

- Windows 或 macOS。
- Node.js `>=24.12.0 <25`。
- pnpm `10.28.1`，以根目录 `package.json` 的 `packageManager` 为准。

安装依赖：

```bash
corepack enable
pnpm install --frozen-lockfile
```

浏览器 Mock UI 开发：

```bash
pnpm dev
```

`pnpm dev` 只启动带 Mock API 的 Renderer，适合 UI 开发；它不会启动 Electron、PTY 或真实 Shell。

启动真实桌面端：

```bash
pnpm build
pnpm start
```

## 基本使用

1. 点击 Header 的「+」新建 Terminal Session，选择系统发现到的 Shell。
2. Session 默认从当前用户主目录启动；在终端中自行执行 `ssh`、跳板、`docker exec`、WSL 或其他认证流程。
3. 多个 Session 以标签形式切换，可通过「全部会话」搜索；右键标签可重命名。
4. 关闭终端前会要求确认；应用退出时终止全部 Session。

Session 仅存在于应用运行期内存中，应用退出即清空，不做任何磁盘持久化；每次打开应用都从空会话列表开始。

## 常用命令

| 命令                          | 用途                                      |
| ----------------------------- | ----------------------------------------- |
| `pnpm verify`                 | Prettier、ESLint、TypeScript 和 Vitest    |
| `pnpm test`                   | 运行 `apps/` 与 `packages/` 单元/集成测试 |
| `pnpm test:e2e`               | 运行 Playwright 浏览器 E2E                |
| `pnpm build`                  | 构建 Electron Main、preload、Renderer     |
| `pnpm package:mac`            | 构建 macOS DMG                            |
| `pnpm package:win`            | 构建 Windows NSIS 安装包                  |
| `pnpm smoke:packaged-desktop` | 对已打包应用执行真实 PTY 冒烟             |

更完整的说明见 [运行手册](docs/runbook.md) 与 [架构说明](docs/architecture.md)。

## 架构与数据

```text
React Renderer
        | 受限 preload API
        v
Electron Main（Terminal Host）
   ├─ PTY / Session / IPC
   └─ ipcMain 通道
```

Renderer 不直接持有 Node API、PTY 或 Session 内部状态。Electron Main 通过 `terminal-host.ts` 统一装配 `terminal-service` 与 `domain`；仓库只保留 `domain`、`terminal-service`、`test-kit` 三个 workspace 包。

## 文档

- [架构说明](docs/architecture.md)
- [安全边界](docs/security.md)
- [运行手册](docs/runbook.md)
- [验证矩阵](docs/verification-matrix.md)

## 许可证

本项目基于 MIT 许可证发布，详见 [LICENSE](LICENSE)。
