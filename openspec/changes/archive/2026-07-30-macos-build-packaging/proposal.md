## Why

当前构建和打包流水线完全绑定 Windows — `stage-core-runtime.mjs` 在第一行就拒绝非 win32 平台，`electron-builder.yml` 只有 `win` 段，所有 native module 筛选逻辑只保留 `win32-x64`。开发者在 macOS 上无法完成本地打包调试，阻碍了跨平台开发和 macOS 平台的支持。

## What Changes

- `stage-core-runtime.mjs` 增加 macOS (darwin/arm64) 分支：平台检测、Node 二进制复制、native module 筛选（keyring-darwin-arm64、node-pty darwin-arm64 prebuild）、chmod +x 防护
- `electron-builder.yml` 新增 `mac` 段，配置 dmg 目标格式
- `package.json` 新增 `package:mac` 和 `package:mac:dir` 脚本
- `electron-main.ts` 将硬编码的 `node.exe` 改为按平台选择二进制名称
- `shell-locator.ts` 新增 macOS shell 发现（zsh、bash），扩展 `LocalShellKind` 类型
- `pty-adapter.ts` 按平台选择 `useConpty`，替换 Windows-only 的进程清理为 POSIX kill
- `smoke-packaged-core.ts` 和 `smoke-packaged-maintenance.ts` 去除 Windows 硬编码

本次只做 arm64，不做 Intel (x64)；不做 Apple 代码签名和公证。

## Capabilities

### New Capabilities
- `macos-build-packaging`: macOS (darwin/arm64) 平台的 Core Runtime staging、electron-builder 打包、Desktop 应用启动、shell 发现和 PTY 适配

### Modified Capabilities
<!-- 本次没有现有 spec 的需求级变更 -->

## Impact

- 构建脚本：`scripts/stage-core-runtime.mjs`、`scripts/smoke-packaged-core.ts`、`scripts/smoke-packaged-maintenance.ts`
- Electron 配置：`electron-builder.yml`、`package.json`
- Desktop 应用层：`apps/desktop/src/electron-main.ts`、`apps/desktop/src/shell-locator.ts`、`apps/desktop/src/pty-adapter.ts`
- 依赖：无新增依赖，pnpm-lock.yaml 中已有 `@napi-rs/keyring-darwin-arm64` 和 `node-pty` darwin-arm64 prebuild
