# 开发环境

本文面向贡献者，描述如何在本地构建和运行 Synapse Term。用户安装路径见[安装与首次启动](../getting-started/install.md)。

## 前置条件

- Node.js `>=24.12.0 <25`；先用 `nvm ls` 检查，优先 `nvm use` 已安装的满足版本，缺失时再安装。
- pnpm `10.28.1`，以根 `package.json` 的 `packageManager` 为准。
- Windows 正式打包需要 Visual Studio 的 C++ 桌面开发工具和 Windows SDK。
- macOS 打包需要原生 arm64 环境；更新链还需要 `SPARKLE_PUBLIC_KEY`，正式签名需要受保护的 `SPARKLE_PRIVATE_KEY`。

仓库只使用 `pnpm-lock.yaml`。不要运行会生成 `package-lock.json`、`yarn.lock` 或其他第二套锁文件的安装命令。

## 安装依赖

```bash
corepack enable
pnpm install --frozen-lockfile
```

## Renderer 开发

```bash
pnpm dev
```

该命令启动带 Mock API 的浏览器 Renderer，适合布局、交互和响应式状态验证。它不会启动 Electron Main、PTY、Session 或真实 Shell。

## 真实桌面端

```bash
pnpm build
pnpm start
```

真实桌面端由 Electron Main 创建并持有 Session runtime、MCP runtime 和 PTY；Renderer 只能通过受限 preload API 访问这些能力。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm verify` | Prettier、ESLint、TypeScript 和 Vitest 全量验证 |
| `pnpm test` | 单元、集成和协议测试 |
| `pnpm test:coverage` | 生成 Vitest 覆盖率报告 |
| `pnpm test:e2e` | Playwright 浏览器 E2E |
| `pnpm build` | 构建 Main、preload 和 Renderer |
| `pnpm package:win` | 构建 Windows x64 NSIS 安装包 |
| `pnpm package:win:dir` | 生成 Windows 未封装目录 |
| `pnpm package:mac` | 构建 macOS arm64 DMG |
| `pnpm package:mac:dir` | 生成 macOS 未封装应用目录 |
| `pnpm smoke:packaged-desktop <app>` | 对已打包应用执行真实 PTY 冒烟 |
| `pnpm icons:generate` | 从 SVG 重新生成 `build/icon.png` 和 macOS `icon.icns` |

打包产物位于 `release/`，命名统一为 `Synapse-Term-<version>...`。测试细节见[测试指南](testing.md)，正式发布见[发布正式版本](../maintainers/releasing.md)。

## 仓库布局

```text
apps/desktop/                  Electron Main、preload、Renderer 和 E2E
packages/domain/               Session、终端和外部调用领域模型
packages/terminal-service/     PTY 适配、SessionActor/Manager 和 Shell 驱动
packages/session-runtime/      Session 生命周期和运行端装配
packages/mcp-runtime/          Sharing、MCP、审批、输入授权和输出历史
packages/test-kit/             Fake PTY 和测试替身
docs/                          用户、开发、维护、架构和安全文档
openspec/                      变更提案、规格、任务和归档
```

依赖必须经过各 package 的公共出口；领域模型不得反向依赖终端服务、Electron 或 UI。完整进程和依赖关系见[架构说明](../architecture/architecture.md)。
