# macos-build-packaging Specification

## Purpose
规定 Synapse Term 在 macOS arm64 上生成 DMG 与未打包目录的构建要求，以及本地 Shell 发现、PTY 创建和进程树终止的跨平台适配，支持验证真实桌面终端生命周期并保持 Windows 打包与运行路径可用。

## Requirements

### Requirement: electron-builder macOS 目标
`electron-builder.yml` SHALL 包含 `mac` 段，配置 `target` 为 `dmg`。`package.json` SHALL 提供 `package:mac` 和 `package:mac:dir` 脚本，直接构建 desktop 应用，不得包含 `package:core` 或 Core Runtime staging 步骤。安装产物名称 SHALL 使用 `Synapse-Term-<version>`。

#### Scenario: 生成 macOS dmg 产物
- **WHEN** 在 macOS 上运行 `pnpm package:mac`
- **THEN** `release/` 目录中生成 `Synapse-Term-<version>-arm64.dmg`

#### Scenario: 生成 macOS unpacked 目录
- **WHEN** 在 macOS 上运行 `pnpm package:mac:dir`
- **THEN** `release/mac-arm64/` 目录中存在 `Synapse Term.app`

### Requirement: macOS shell 发现
`ShellLocator` SHALL 在 `process.platform === 'darwin'` 时发现并返回系统可用的 shell 列表，至少包含 zsh 和 bash。`LocalShellKind` 类型 SHALL 包含 `'zsh'`。

#### Scenario: macOS 默认 shell 列表
- **WHEN** 在 macOS 上调用 `ShellLocator.list()`
- **THEN** 返回的列表中 SHALL 包含 `kind: 'zsh'` 且 `executable` 指向 `/bin/zsh` 的描述符（如果存在），以及 `kind: 'bash'` 且 `executable` 指向 `/bin/bash` 的描述符（如果存在）

#### Scenario: `#pathDirectories` 跨平台分隔符
- **WHEN** 在任何平台上解析 PATH 环境变量
- **THEN** SHALL 使用 `path.delimiter`（macOS 为 `:`，Windows 为 `;`）分割

### Requirement: PTY adapter 平台适配
`NodePtySpawner.spawn()` SHALL 按平台选择 `useConpty`：win32 为 `true`，其他平台为 `false`。进程终止 SHALL 在 macOS 上使用 POSIX 进程组信号（`SIGTERM` + `SIGKILL`），Windows 保留 `taskkill.exe`。

#### Scenario: macOS 上创建 PTY
- **WHEN** 在 macOS 上通过 `NodePtySpawner.spawn()` 启动 zsh
- **THEN** 传给 node-pty 的 `useConpty` 为 `false`，PTY 正常工作

#### Scenario: macOS 上终止 PTY 进程树
- **WHEN** 在 macOS 上调用 `PtyAdapter.terminate()`
- **THEN** SHALL 向进程组发送 `SIGTERM`，若进程未退出则发送 `SIGKILL`
