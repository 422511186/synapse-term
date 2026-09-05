# GitHub Release 发布说明流程

## 原则

- 发布说明面向**最终用户**，使用简体中文；它不是 git log 的搬运，而是说明「本次发布对使用者意味着什么」。
- 范围 = 自上一发布 tag 起的用户可见变化；只写仓库中**真实发生且已合并**的变更，不描述规划或半成品。
- 自动化与人工/Agent 分工：`release.yml` 负责打包与创建 Release（`gh release create --generate-notes` 产出占位说明），发布说明的精修由发布者负责。

## 标准流程

1. **准备（发布前）**
   - 确认 develop 及合并后的 master 上 CI（`持续集成`）通过；本地执行 `pnpm verify`。
   - 首个可更新版本发布前，按 [应用更新手册](app-updates.md) 备份生产 Ed25519 密钥，并配置 `release` 环境的 `SPARKLE_PRIVATE_KEY` Secret 与 `SPARKLE_PUBLIC_KEY` Variable。没有 Apple Developer ID 与公证不影响配置这组更新密钥。
   - 同步版本号：根目录 `package.json` 与 `apps/desktop/package.json`（必要时含构建配置）改为同一新版本，提交如 `chore: 同步 vX.Y.Z 版本号`。
   - 用 `git log <上一tag>..HEAD`（排除 merge 提交）收集发布区间提交，并结合 `openspec/` 归档与 `docs/adr/` 判断破坏性变更。
2. **起草发布说明**：按下方结构与模板整理，保存为本地临时文件（如 `.tmp-release-notes-vX.Y.Z.md`，由 `.gitignore` 排除，不提交入库）。
3. **发布**：合并 develop 到 master 后，在 master 上打稳定版本 `vX.Y.Z` tag 并推送。tag 推送触发 `release.yml`：验证版本与生产密钥，构建 Windows/macOS，检查包内版本、公钥、清单、摘要和 DMG 签名；全部通过后创建 draft，上传完整资产，再发布为正式 Release。当前更新链不接受预发布 tag。
4. **精修说明（发布后）**：工作流成功后，用精修稿覆盖自动生成的占位说明：

   ```bash
   gh release edit vX.Y.Z --notes-file .tmp-release-notes-vX.Y.Z.md
   ```

5. **验收**：用 `gh release view vX.Y.Z` 核对正文、EXE、EXE.blockmap、`latest.yml`、DMG、`appcast.xml`、`mac-update-build.json` 与 `SHA256SUMS.txt` 均就位。0.5.1 用户需要手动安装一次引导版本，后续验证应用内更新；macOS 实机限制应明确写入说明。

已发布安装包和更新清单不可覆盖上传。工作流遇到已有 Release 会失败；检查并删除从未公开的失败草稿后可以重跑，已公开版本的问题应发布更高版本修复。测试密钥构建只能作为 CI Artifact，不能用于正式 Release。

## 发布说明结构模板

```markdown
# Synapse Term vX.Y.Z

本次发布聚焦「一句话主题概述」。

## 破坏性变更

- 说明行为变化、影响范围与迁移方式（没有则删除本节）。

## 新功能

- 面向用户的一句话功能描述，必要时注明入口或用法。

## 修复

- 描述用户可感知的问题修复（说明原现象与结果）。

## 内部改进与维护

- 重构、依赖升级、文档与测试等（用户不可感知的改动并入本节，不必逐条展开）。

## 下载与校验

- Windows x64 安装包、macOS arm64 DMG 见本 Release 资产；
- 安装前可用 `SHA256SUMS.txt` 校验文件完整性。

> [!NOTE] 签名提示（固定段落，每次发布必须保留）
> 当前 Release 未配置 Windows 或 macOS 产品签名证书。macOS 首次打开若提示应用来自身份不明的开发者，可先将应用拖入 /Applications，再在终端执行：
> `xattr -dr com.apple.quarantine "/Applications/Synapse Term.app"`
> 然后从"应用程序"目录启动应用。该命令只移除下载文件的隔离属性，不会为应用添加开发者签名。
```

## 写作约束

- 每条目为一行动宾短句，先写用户价值、后写实现细节；避免 commit 内部行话与实现术语。
- 新功能/修复条目优先标注对应的 Issue、PR 或 OpenSpec Change 链接。
- 破坏性变更必须置顶并给迁移指引；其余按「新功能 → 修复 → 维护」排序。
- 首次发布（无上一 tag）时，从仓库首个有意义的里程碑起梳理，并在说明中标注这是首个正式版本。
- 「下载与校验」中的签名提示为**固定段落**，每次发布必须原样保留；项目正式配置签名证书后移除。
