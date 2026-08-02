## Purpose

支持 macOS arm64 的 Core Runtime staging、桌面应用目录打包与平台适配验证，同时保持 Windows 打包路径可用。

## Requirements

### Requirement: macOS Core Runtime staging
`stage-core-runtime.mjs` SHALL 在 `process.platform === 'darwin'` 时完成 Core Runtime staging，包括：复制当前 Node 二进制为 `node`（非 `node.exe`）、筛选 `@napi-rs/keyring-darwin-arm64` 和 `node-pty` 的 `darwin-arm64` prebuild、保留 `tree-sitter-bash.wasm`、生成 `runtime-manifest.json`。复制完成后 SHALL 对 Node 二进制执行 `chmod 0o755`。

#### Scenario: macOS arm64 staging 完整输出
- **WHEN** 在 macOS arm64 上运行 `node scripts/stage-core-runtime.mjs`
- **THEN** `.packaging/core-runtime/` 中存在 `node`（可执行）、`dist/core-main.mjs`、`dist/core-maintenance.mjs`、`node_modules/@napi-rs/keyring-darwin-arm64/`、`node_modules/node-pty/prebuilds/darwin-arm64/`、`node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter-bash.wasm`、`runtime-manifest.json`

#### Scenario: macOS staging 不包含 Windows 原生模块
- **WHEN** 在 macOS arm64 上完成 staging
- **THEN** `.packaging/core-runtime/node_modules/` 中 SHALL NOT 存在 `@napi-rs/keyring-win32-x64-msvc` 目录或 `node-pty/prebuilds/win32-x64` 目录

### Requirement: electron-builder macOS 目标
`electron-builder.yml` SHALL 包含 `mac` 段，配置 `target` 为 `dmg`。`package.json` SHALL 提供 `package:mac` 和 `package:mac:dir` 脚本，与 Windows 的 `package:win` 和 `package:win:dir` 对称。

#### Scenario: 生成 macOS dmg 产物
- **WHEN** 在 macOS 上运行 `pnpm package:mac`
- **THEN** `release/` 目录中生成 `Terminal-Agent-<version>-arm64.dmg`

#### Scenario: 生成 macOS unpacked 目录
- **WHEN** 在 macOS 上运行 `pnpm package:mac:dir`
- **THEN** `release/mac-arm64/` 目录中存在 `Terminal Agent.app`

### Requirement: Desktop 启动 Core 使用平台正确的 Node 二进制
`electron-main.ts` 中 `resolveCoreLaunch` SHALL 按 `process.platform` 选择打包后的 Node 二进制名称：win32 使用 `node.exe`，darwin 使用 `node`。

#### Scenario: macOS 打包后启动 Core
- **WHEN** 在 macOS 上以 packaged 模式启动 Desktop
- **THEN** Desktop SHALL 用 `<resourcesPath>/core/node` 启动 Core 进程

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

### Requirement: smoke test 跨平台运行
`smoke-packaged-core.ts` 和 `smoke-packaged-maintenance.ts` SHALL 使用平台变量替代 `node.exe` 硬编码。Core session 的验证 shell SHALL 在 macOS 上使用 `zsh` 替代 `powershell.exe`。

#### Scenario: macOS smoke test 验证 packaged Core
- **WHEN** 在 macOS 上运行 `pnpm smoke:core-package`
- **THEN** SHALL 用 staging 目录中的 `node` 启动 Core，用 `zsh` 创建 session 并验证输出
