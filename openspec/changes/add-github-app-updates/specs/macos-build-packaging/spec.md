## MODIFIED Requirements

### Requirement: electron-builder macOS 目标
`electron-builder.yml` SHALL 包含 `mac` 段，配置 `target` 为 `dmg`。`package.json` SHALL 提供 `package:mac` 和 `package:mac:dir` 脚本，直接构建 desktop 应用，不得包含 `package:core` 或 Core Runtime staging 步骤。安装产物名称 SHALL 使用 `Synapse-Term-<version>`。macOS arm64 应用 SHALL 打包锁定的 Sparkle framework、原生更新适配、公钥及固定 appcast 配置，禁止自动下载、退出时安装和系统画像上传；更新器 SHALL 在解包前验证 Ed25519 签名。项目不具备 Developer ID 或公证时 SHALL 保留所需的 ad-hoc 签名而不得宣称获得公证或自动清除 quarantine。

#### Scenario: 生成 macOS dmg 产物
- **WHEN** 在 macOS 上运行 `pnpm package:mac`
- **THEN** `release/` 目录中生成 `Synapse-Term-<version>-arm64.dmg`，其中包含可供 Main 调用的 Sparkle 原生更新适配

#### Scenario: 生成 macOS unpacked 目录
- **WHEN** 在 macOS 上运行 `pnpm package:mac:dir`
- **THEN** `release/mac-arm64/` 目录中存在 `Synapse Term.app`

#### Scenario: Missing update public key
- **WHEN** 正式 macOS 打包未配置有效的生产更新公钥
- **THEN** 构建明确失败，不能生成声称可更新但没有信任根的正式包

#### Scenario: Native helper loses its parent
- **WHEN** 用户未确认安装而 Main 退出或结构化通信中断
- **THEN** helper 撤销待安装操作并退出，MUST NOT 等待普通退出后安装
