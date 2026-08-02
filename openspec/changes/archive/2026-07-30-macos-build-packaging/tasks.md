## 1. Core Runtime staging 跨平台

- [x] 1.1 `stage-core-runtime.mjs`：在顶部定义平台常量（`platform`、`nodeBinary`、`keyringSuffix`、`ptyPrebuildDir`），移除 `process.platform !== 'win32'` 的硬拒绝，改为 `if (platform !== 'win32' && platform !== 'darwin')` 校验
- [x] 1.2 `stage-core-runtime.mjs`：Node 二进制校验从 `node.exe` 改为按 `nodeBinary` 变量检查，复制目标文件名用 `nodeBinary` 变量
- [x] 1.3 `stage-core-runtime.mjs`：`includeOptionalDependency` 按 `keyringSuffix` 放行对应平台的 keyring 包
- [x] 1.4 `stage-core-runtime.mjs`：`pruneRuntimePackages` 按 `ptyPrebuildDir` 保留对应平台的 node-pty prebuild 目录
- [x] 1.5 `stage-core-runtime.mjs`：manifest 中 `nodeSha256` 路径和验证列表使用 `nodeBinary` 变量
- [x] 1.6 `stage-core-runtime.mjs`：复制 Node 二进制后执行 `chmod 0o755`（仅 macOS，Windows 跳过）

## 2. electron-builder 和 package.json

- [x] 2.1 `electron-builder.yml`：新增 `mac` 段，配置 `target: dmg`，`artifactName` 使用 `${arch}`
- [x] 2.2 `package.json`：新增 `package:mac` 和 `package:mac:dir` 脚本

## 3. Desktop 应用层适配

- [x] 3.1 `electron-main.ts`：`resolveCoreLaunch` 中 `node.exe` 改为按 `process.platform` 选择 `node` 或 `node.exe`
- [x] 3.2 `shell-locator.ts`：`LocalShellKind` 类型扩展为包含 `'zsh'`
- [x] 3.3 `shell-locator.ts`：`list()` 方法开头按平台分支，macOS 走 `#darwinShells()` 发现 zsh 和 bash
- [x] 3.4 `shell-locator.ts`：`#pathDirectories()` 使用 `path.delimiter` 替代 `win32.delimiter` 硬编码
- [x] 3.5 `pty-adapter.ts`：`useConpty` 改为 `process.platform === 'win32'`
- [x] 3.6 `pty-adapter.ts`：`NodePtySpawner` 构造时按平台选择进程清理策略，macOS 用 `process.kill(-pid, 'SIGTERM')` + `SIGKILL`

## 4. Smoke test 跨平台

- [x] 4.1 `smoke-packaged-core.ts`：`node.exe` 改为平台变量，`powershell.exe` 改为 `zsh`，`Write-Output` 改为 `echo`
- [x] 4.2 `smoke-packaged-maintenance.ts`：`node.exe` 改为平台变量

## 5. 端到端验证

- [x] 5.1 在 macOS arm64 上运行 `node scripts/stage-core-runtime.mjs`，验证 staging 输出完整（node 可执行、native module 正确、manifest 生成）
- [x] 5.2 在 macOS arm64 上运行 `pnpm package:mac:dir`，验证 `release/mac-arm64/Terminal Agent.app` 存在
- [x] 5.3 启动打包后的 Desktop，验证 Core 连接、shell 发现、终端可交互
