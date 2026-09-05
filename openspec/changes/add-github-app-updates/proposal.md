## Why

Synapse Term 已通过 GitHub Releases 分发 Windows x64 与 macOS arm64 安装包，但用户必须自行发现新版本、下载并重新安装。需要在应用内完成版本发现、下载、校验和用户确认后的安装重启，并保持 Session 只存在于当前应用运行期的边界。

项目当前不具备 Apple Developer ID 签名和公证条件。首版仍包含 macOS 应用内更新，采用 Sparkle 2 的 Ed25519 更新包验证；用户暂时无法提供 macOS 实机，不因此暂停实现，但必须如实保留真实升级与系统授权的验收缺口。

## What Changes

- 增加基于固定 GitHub 仓库正式 Release 的自动检查与手动检查，仅更新到适配当前平台的更高版本。
- 在通用设置中提供当前版本、发布说明、下载进度、取消或重试、重启并更新，以及自动检查开关。
- Main 持有更新状态，通过受限 preload API 提供能力；Windows 使用 NSIS 与 `electron-updater`，macOS 使用 Sparkle 2 与项目自持 Ed25519 更新密钥。
- 下载和校验独立于安装；普通关窗、退出及下次启动均不得隐式安装。用户明确确认后才停止内嵌 MCP Server、结束 Session 并提交安装。
- 发布流程补齐 Windows 更新清单与 macOS appcast、签名产物，校验版本和资产的一致性。缺少生产更新密钥时不得发布不完整的可更新版本。
- 明确更新缓存与偏好的本地存储范围、未公证应用的系统提示，以及现有无更新器版本需要手动安装一次引导版本的迁移要求。

## Capabilities

### New Capabilities

- `application-updates`: 正式版本发现、下载校验、用户确认安装、更新状态与 Session 生命周期协调。
- `github-update-distribution`: 双平台更新产物、Ed25519 更新密钥、发布完整性与引导版本迁移。

### Modified Capabilities

- `desktop-runtime-assurance`: 扩展声明的 DesktopApi，增加受限本机更新管理与更新事件。
- `macos-build-packaging`: 打包 Sparkle 适配与更新公钥，在没有 Developer ID 和公证时提供 DMG 更新产物。
- `settings-workspace`: 在现有通用设置中增加应用更新区块与确认安装流程。

## Impact

- 影响 `apps/desktop` 的 Main 装配、退出协调、preload、共享契约、设置与更新 UI；不向领域模型、Session runtime 或 MCP 工具增加更新依赖。
- 影响 `electron-builder.yml`、desktop 构建配置、Windows 安装脚本、macOS 原生更新适配、构建与发布脚本及 GitHub Actions。
- 增加 desktop 的 `electron-updater` 依赖，以及锁定版本的 Sparkle framework 与原生适配构建；无需 Apple 账号或产品签名证书。
- 更新文档中的缓存边界，并记录不同平台更新器与信任来源的 ADR。现有 Windows 最后关窗退出与 Session Detach 规格的冲突另行保留，本变更通过禁止隐式安装避免把该行为视为更新授权。
- 本机检查覆盖状态机、IPC、UI、发布产物校验和可执行的平台验证；macOS 的 Gatekeeper、权限交互、真实替换与重启保持待验收，不能用 mock 或上游测试代替项目实机结果。
