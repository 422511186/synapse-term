## MODIFIED Requirements

### Requirement: electron-builder macOS 目标
`electron-builder.yml` SHALL 包含 `mac` 段，配置 `target` 为 `dmg`。`package.json` SHALL 提供 `package:mac` 和 `package:mac:dir` 脚本，直接构建 desktop 应用，不得包含 `package:core` 或 Core Runtime staging 步骤。安装产物名称 SHALL 使用 `Synapse-Term-<version>`。

#### Scenario: 生成 macOS dmg 产物
- **WHEN** 在 macOS 上运行 `pnpm package:mac`
- **THEN** `release/` 目录中生成 `Synapse-Term-<version>-arm64.dmg`

#### Scenario: 生成 macOS unpacked 目录
- **WHEN** 在 macOS 上运行 `pnpm package:mac:dir`
- **THEN** `release/mac-arm64/` 目录中存在 `Synapse Term.app`

## REMOVED Requirements

### Requirement: macOS Core Runtime staging
**Reason**: 独立 Core 进程与 `stage-core-runtime.mjs` 已删除。
**Migration**: electron-builder 直接打包 desktop，不再 staging Node 运行时。

### Requirement: Desktop 启动 Core 使用平台正确的 Node 二进制
**Reason**: 不再启动 Core 子进程，无需打包 Node 二进制。
**Migration**: 终端运行时内嵌于 Electron Main。

### Requirement: smoke test 跨平台运行
**Reason**: `smoke-packaged-core.ts` 与 `smoke-packaged-maintenance.ts` 随 Core 删除。
**Migration**: 打包验证由桌面端构建、E2E 与安装器生命周期测试承担。
