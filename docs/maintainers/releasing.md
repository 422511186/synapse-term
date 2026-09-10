# 发布正式版本

本文面向发布负责人。用户如何更新见[更新 Synapse Term](../guides/updates.md)；发布说明结构和措辞见[发布说明写作](release-notes.md)；平台和验收细节见[发布与更新验收](release-validation.md)。

## 原则

- 发布说明面向最终用户，使用简体中文，描述从上一发布 tag 起真实发生且已合并的用户可见变化。
- `release.yml` 负责验证、打包和创建 GitHub Release（`gh release create --generate-notes` 先生成占位说明）；发布者负责精修说明。
- 已发布安装包、清单和签名不可覆盖上传；已公开错误只能通过更高版本修复。

## 发布前

1. 确认 develop 及合并后的 master 上 CI 通过；本地执行 `pnpm verify`。
2. 首个可更新版本发布前，按[应用更新维护](application-updates.md)备份生产 Ed25519 密钥，并配置 `release` 环境的 `SPARKLE_PRIVATE_KEY` Secret 与 `SPARKLE_PUBLIC_KEY` Variable。没有 Apple Developer ID 与公证不影响这组更新密钥的配置。
3. 同步根 `package.json` 与 `apps/desktop/package.json` 的版本号，提交独立的版本变更，例如 `chore: 同步 vX.Y.Z 版本号`。
4. 使用 `git log <上一tag>..HEAD`（排除 merge 提交）收集发布区间，并结合归档 OpenSpec 和 ADR 判断破坏性变化。
5. 按[发布说明写作](release-notes.md)中的结构起草发布说明，保存为本地临时文件（例如 `.tmp-release-notes-vX.Y.Z.md`）；该文件由 `.gitignore` 排除，不提交入库。

## 发布

1. 在 master 上创建稳定的 `vX.Y.Z` tag 并推送。
2. `release.yml` 验证版本和生产密钥，在 Windows x64 与 macOS arm64 环境构建并检查包内版本、公钥、清单、摘要和 DMG 签名。
3. 工作流创建 draft，上传完整资产并发布为不可变 Release；当前更新链不接受预发布 tag。
4. 用临时文件覆盖自动生成的占位说明：

   ```bash
   gh release edit vX.Y.Z --notes-file .tmp-release-notes-vX.Y.Z.md
   ```

5. 用 `gh release view vX.Y.Z` 验收正文和资产，确认 EXE、EXE.blockmap、`latest.yml`、DMG、`appcast.xml`、`mac-update-build.json` 与 `SHA256SUMS.txt` 均就位；资产清单和平台动作见[发布与更新验收](release-validation.md)。

已发布安装包和更新清单不可覆盖上传。工作流遇到已有 Release 会失败；检查并删除从未公开的失败草稿后可以重跑，已公开版本的问题应发布更高版本。测试密钥构建只能作为 GitHub Actions Artifact，不能用于正式 Release。

发布说明不替代 README，也不把未完成规划写成变化。首次发布（没有上一 tag）时，从仓库首个有意义的里程碑起梳理，并在说明中标注这是首个正式版本。下载与校验中的固定签名提示、包括 macOS 的 `xattr` 操作，必须按[发布说明写作](release-notes.md)要求原样保留；只有正式配置产品签名证书后才能移除。
