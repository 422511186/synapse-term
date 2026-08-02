## Context

Terminal Agent 是一个 Electron 桌面应用，由两部分组成：Desktop（Electron UI）和 Core（独立 Node 进程，管理 PTY、Agent、存储）。打包时，Core Runtime 被 staging 到 `.packaging/core-runtime/`，包含版本锁定的 Node 二进制、Core 代码和原生模块，然后通过 electron-builder 的 `extraResources` 嵌入应用。

当前整个构建链路只支持 Windows：
- `stage-core-runtime.mjs` 第一行 `if (process.platform !== 'win32') throw`
- `electron-builder.yml` 只有 `win` 段（NSIS 安装器）
- native module 筛选只保留 `win32-x64` 的 keyring 和 node-pty prebuild
- smoke test 硬编码 `node.exe`、`powershell.exe`

IPC 层（`NamedPipeCoreConnector` + `core-paths.ts`）已经是跨平台的：Windows 用 named pipe，非 Windows 用 Unix socket。UI 层（`electron-window.ts`）使用 `titleBarStyle: 'hiddenInset'`，已是 macOS 原生风格。

## Goals / Non-Goals

**Goals:**
- 开发者能在 macOS (arm64) 上完成 `pnpm package:mac` 端到端打包
- 打包后的 `.app` / `.dmg` 能在 macOS 上启动 Desktop、连接 Core、打开终端
- smoke test 能在 macOS 上验证打包后的 Core Runtime

**Non-Goals:**
- macOS Intel (x64) 支持 — 后续再加
- Apple 代码签名和公证 — 开发阶段不需要
- Linux 支持 — 不在本次范围
- CI/CD 流水线 — 后续用 GitHub Actions macOS runner 做
- Fish shell 支持 — 用户量小，后续再加
- `verify-installer-lifecycle.ps1` 的 macOS 等价物 — smoke test 已覆盖端到端验证

## Decisions

### D1: Core Runtime staging 采用 platform if/else 分支

在 `stage-core-runtime.mjs` 顶部定义平台常量，后续逻辑通过这些常量分支：

```
platform       = process.platform              // 'win32' | 'darwin'
nodeBinary     = platform === 'win32' ? 'node.exe' : 'node'
keyringSuffix  = platform === 'win32' ? 'win32-x64-msvc' : 'darwin-arm64'
ptyPrebuildDir = platform === 'win32' ? 'win32-x64' : 'darwin-arm64'
```

**考虑过的替代方案：** Strategy 模式（WindowsStagingStrategy / MacStagingStrategy）。目前只有两个平台，if/else 更直觉，等第三个平台出现再抽象。

### D2: Node 二进制复制策略 — 方案 A（对称复制）

macOS 上同样复制 `process.execPath` 到 staging 目录（命名为 `node` 而非 `node.exe`），保持与 Windows 对称。复制后 `chmod 0o755` 防止权限丢失。

**考虑过的替代方案：** 不复制 node，运行时用系统 node。缺点是版本不锁定，`REQUIRED_NODE_VERSION` 校验失去意义。

### D3: macOS shell 发现 — if/else 分支 + zsh/bash

`ShellLocator.list()` 开头按 `process.platform` 分支。macOS 走 `#darwinShells()` 方法，发现 `/bin/zsh` 和 `/bin/bash`。`LocalShellKind` 扩展为 `'bash' | 'powershell' | 'wsl' | 'zsh'`。`#pathDirectories()` 改用 `path.delimiter` 实现跨平台。

### D4: PTY adapter 平台适配

- `useConpty` 改为 `process.platform === 'win32'`（一行改动）
- `forceKillWindowsProcessTree` 替换为：Windows 保留 `taskkill.exe`，macOS 用 `process.kill(-pid, 'SIGTERM')` + `process.kill(-pid, 'SIGKILL')`（进程组信号）

### D5: electron-builder macOS 配置

新增 `mac` 段，target 为 `dmg`（加 `dir` 用于本地调试），与 Windows 的 `nsis` + `dir` 对称。不配置签名和公证。

## Risks / Trade-offs

**[Node 二进制权限丢失]** staging 复制的 `node` 文件可能缺少 `+x` 权限 → 复制后显式 `chmod 0o755` 防护。

**[native module 兼容性]** `@napi-rs/keyring` 和 `node-pty` 的 macOS prebuild 已存在于 pnpm-lock.yaml，但 staging 筛选逻辑需要正确放行 → 通过 `keyringSuffix` 和 `ptyPrebuildDir` 常量保证。

**[未签名应用首次启动]** macOS Gatekeeper 会拦截未签名的 .app → 用户需在"安全性与隐私"中手动允许，或右键打开。开发阶段可接受。

**[Shell 发现不覆盖所有场景]** macOS 上用户可能用 Homebrew 装的 bash 5 或自定义 shell → zsh + bash 覆盖 99% 用户，fish 后续再加。
