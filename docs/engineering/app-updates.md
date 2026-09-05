# 应用更新：构建、发布与验收

## 更新行为

正式打包的 Windows x64 与 macOS arm64 应用从固定公开仓库 `422511186/synapse-term` 检查更新，不需要客户端 GitHub Token。仅接受稳定的 `X.Y.Z` 版本，忽略草稿、预发布、旧版本及缺少本平台完整资产的发布。开发模式不联网更新。

自动检查默认在启动 15 秒后执行，随后每 6 小时检查一次。通用设置中的开关会持久保存；手动检查合并并发请求，30 秒内限制重复检查，网络检查超时为 30 秒。发现版本不触发下载。用户下载后仍须明确确认安装，普通退出、关窗或下次启动都不会安装更新。

安装确认有效期为 60 秒，只能使用一次，绑定一个固定候选和当时的活动 Session 集合。准备期间新增或替换 Session、确认过期、包被修改都会拒绝安装。确认生效后，Main 阻止新建 Session 和外部调用，停止内嵌 MCP Server，清理 Sharing 与审批，再结束全部 Session、提交安装。Session 不会在更新后恢复。

Windows 使用 `electron-updater` 6.8.9 的 NSIS 下载、SHA-512 校验与显式 `quitAndInstall`。Windows 没有产品签名证书，摘要校验不能代替发布者身份认证，来源信任依赖固定 GitHub 仓库与 HTTPS。

macOS 使用 Sparkle 2.9.6 和项目自持 Ed25519 更新密钥。Main 先下载并验证 DMG，native helper 在结束 Session 前检查目标应用所在卷，拒绝只读卷（包括直接从 DMG 运行）；确认并结束 Session 后，Sparkle 再次下载、验证、替换及重启。这个阶段可能需要第二次下载，仍须保持网络可用。这样可以避免 Sparkle 提前准备安装后，在普通退出时自动更新。

Ed25519 更新签名不等于 Apple Developer ID 签名或公证。当前应用只做运行所需的 ad-hoc 签名，没有 Apple 开发者身份与公证，仍可能出现 Gatekeeper 或目录权限提示。更新器不会自动移除 quarantine 或绕过系统授权。系统拒绝发生在 Session 已结束之后时，只能报告失败，不能恢复 Session。

## 首次迁移

现有 0.5.1 或其他不含更新器的版本不能自己发现这次功能。用户需要从 GitHub Releases 手动下载并安装一次带生产公钥的引导版本，之后才能使用应用内更新。首次引导版本和后续版本都应沿用同一更新公钥；本变更本身不提升 0.5.1 版本号，也不创建 Release。

## 发布负责人需要完成的步骤

这些步骤只需在首个引导版本发布前完成。私钥不要发到聊天、提交到 Git 或上传为构建产物。

1. 在 GitHub 仓库 Settings → Environments 创建 `release` 环境，限制发布分支或 tag，并按团队需要配置审核。工作流的生产构建与发布使用这个环境。
2. 在仓库根目录用下面的 PowerShell 命令生成密钥。脚本要求绝对路径且拒绝覆盖已有文件，私钥格式是 Sparkle 2.9.6 支持的 32 字节 seed 的 Base64；`.pub` 为 32 字节公钥的 Base64。

   ```powershell
   $keyDirectory = Join-Path $env:USERPROFILE '.synapse-term-update-keys'
   New-Item -ItemType Directory -Path $keyDirectory -Force | Out-Null
   $keyFile = Join-Path $keyDirectory 'production-ed25519.key'
   pnpm updates:keys $keyFile
   ```

3. 把私钥及对应 `.pub` 文件备份到受保护的离线存储或密码管理器，限制本机文件访问。确认备份可读取后，配置 `release` 环境的 Secret 和 Variable。下面命令从文件向 GitHub CLI 的标准输入传递私钥，不把私钥放入命令参数。

   ```powershell
   Get-Content -LiteralPath $keyFile -Raw | gh secret set SPARKLE_PRIVATE_KEY --env release --repo 422511186/synapse-term
   gh variable set SPARKLE_PUBLIC_KEY --env release --repo 422511186/synapse-term --body ((Get-Content -LiteralPath "$keyFile.pub" -Raw).Trim())
   ```

4. 按 [发布流程](release.md) 同步两个 package 版本并发布引导版本。生产工作流在缺少密钥、密钥不匹配、包内公钥不匹配或发现测试构建标记时失败。
5. 手动安装引导版本，后续在 Mac 可用时按下方清单验收下一正式版本。生产更新链至少需要两个递增版本。

私钥不会打包进应用，公钥写入主应用 `Info.plist`。不能随意重新生成生产密钥；没有 Developer ID 作为另一条信任链时，私钥丢失可能需要用户手动安装含新公钥的引导版本。发现私钥泄露时暂停发布并人工迁移，不能依靠同一失信密钥恢复信任。

## 构建与发布资产

Windows：

```powershell
pnpm package:win
pnpm smoke:packaged-desktop 'release/win-unpacked/Synapse Term.exe'
pnpm test:installer -SetupPath 'release/Synapse-Term-X.Y.Z-x64-Setup.exe' -UpgradeSetupPath 'path/to/Synapse-Term-X.Y.N-x64-Setup.exe'
```

安装测试拒绝在已安装 Synapse Term 的机器上执行，使用临时安装目录，检查 `/S`、`--updated --force-run`、版本替换、进程重启和卸载保留数据。省略 `-UpgradeSetupPath` 时执行同版本覆盖测试；验证跨版本时必须传入更高版本，不能将同版本测试称为跨版本升级。

macOS arm64 在配置 `SPARKLE_PUBLIC_KEY` 后执行：

```bash
pnpm package:mac
pnpm smoke:packaged-desktop 'release/mac-arm64/Synapse Term.app/Contents/MacOS/Synapse Term'
# 仅签名步骤需要 SPARKLE_PRIVATE_KEY
pnpm updates:sign-mac
```

构建脚本校验上游归档 SHA-256，编译 arm64 helper，打包 `Sparkle.framework`、helper 和许可，写入主应用公钥，再校验 ad-hoc 签名、架构与更新配置。上游工具固定到版本及摘要后才执行。签名工具通过标准输入读取私钥，其错误输出不会转发到构建日志。

完整发布资产：

| 资产 | 用途 |
| --- | --- |
| `Synapse-Term-X.Y.Z-x64-Setup.exe` | Windows NSIS 安装与更新 |
| 同名 `.exe.blockmap` | Windows 差分下载；不可用时引擎可回退完整下载 |
| `latest.yml` | 固定版本、EXE 大小及 SHA-512 |
| `Synapse-Term-X.Y.Z-arm64.dmg` | macOS 人工安装与 Sparkle 更新 |
| `appcast.xml` | 固定 DMG URL、版本、大小、架构及 Ed25519 签名 |
| `mac-update-build.json` | 包内版本、公钥、Sparkle 版本和测试构建标记 |
| `SHA256SUMS.txt` | 上述资产的人工完整性校验 |

`pnpm updates:validate <资产目录>` 校验完整资产并生成 SHA256SUMS。Windows 包内版本由 Windows 发布任务检查，macOS 包内版本、公钥、架构和签名由打包钩子检查。最终发布任务还会独立验证 DMG 签名与两个平台的清单。全部通过后才创建 draft、上传资产、发布 Release，不使用覆盖上传。

已发布版本的同名包、清单与签名保持不可变。失败遗留的草稿需要发布负责人检查；确认它从未公开后可以删除草稿并重跑。已经公开的错误版本应通过更高版本修复。

## CI 与测试密钥

`持续集成` 工作流会在 PR、受支持分支推送或手动运行时执行 macOS arm64 构建。`pnpm updates:keys --test-env` 只在 CI 使用，生成本次运行独立密钥和 `SYNAPSE_UPDATE_TEST_BUILD=1`，无需生产 Secret。测试产物名称带 `test`，只作为 GitHub Actions Artifact；不能作为正式客户端或上传到正式 Release。

CI 检查原生编译、包结构、签名、真实 PTY 冒烟和 Sparkle `sign_update` 与 Node Ed25519 的兼容性。浏览器 E2E 只验证界面流程，不证明真实安装成功。CI 编译通过也不能代替 Gatekeeper、交互权限和跨版本更新验收。

## macOS 待验收清单

当前开发环境是 Windows，以下项目尚未执行，需在 macOS arm64、macOS 12 或更新系统上完成并记录实际系统版本、起止应用版本、结果和相关截图。

1. 在 Mac CI 运行本分支，确认 helper 编译、framework 装载、深层签名校验、真实 PTY 和 DMG 签名检查通过。
2. 从正式 GitHub Releases 手动安装含生产公钥的 A 版本到 `/Applications`。记录首次打开的 Gatekeeper 提示和用户操作，不把 CI 测试包当作 A。
3. 发布同公钥且版本递增的 B，确认 A 自动发现并能手动检查。打开两个 Session，完成下载；下载期间取消后，两个 Session 仍可输入，再下载可重新开始。
4. 在已下载状态普通退出，再启动 A：仍应运行 A。重新检查和下载后打开安装确认，取消应保留 Session；确认期间新建 Session，旧确认必须失效。
5. 在专用测试机修改确认前缓存中 DMG 的一个字节，保持大小不变，再提交安装；签名复核必须失败，Session 保留。重新下载后才允许继续。
6. 确认安装，观察 Session 结束、Sparkle 再次下载、必要的权限提示、替换和重启；启动后通用设置必须显示 B。分别覆盖当前用户可写的 `/Applications` 和需要授权的安装位置，以及拒绝系统授权的失败分支。
7. 模拟网络中断、只读目录、应用从 DMG 启动等失败条件，检查失败提示与人工下载入口。已结束的 Session 不得被声称恢复。没有完成上述步骤前，不声明 macOS 真实更新链已验收。

## 本地数据与故障定位

更新偏好位于 Electron `userData/settings/updates.json`。macOS 确认前缓存位于 `userData/updates/download-*`，单包限制 512 MiB，取消或普通退出清理当前暂存包，下次下载清理遗留暂存目录；Sparkle 自身管理原生安装缓存。Windows 使用 electron-updater 的缓存目录，安装前重新校验内容。任何缓存都不保存或恢复安装确认。

检查失败时先确认 GitHub 连通性、API 限流与完整资产是否存在。校验失败应重新下载；正式发布不可通过覆盖文件修复。安装提交后出现问题，以重新打开后的实际版本判断结果，从固定 GitHub Releases 页面人工安装。更新数据不包含 Session、终端输出、运行凭据或集中审计日志。
