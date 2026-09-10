# 发布与更新验收

本文记录发布负责人和 QA 需要执行的真实资产、平台和更新链验收。某台机器尚未完成的项目应放在具体 Release checklist 或 OpenSpec validation，不应改写成已验收事实。

## 资产清单

| 资产 | 用途 |
| --- | --- |
| `Synapse-Term-X.Y.Z-x64-Setup.exe` | Windows NSIS 安装与更新 |
| 同名 `.exe.blockmap` | Windows 差分下载 |
| `latest.yml` | Windows 版本、大小和 SHA-512 |
| `Synapse-Term-X.Y.Z-arm64.dmg` | macOS 人工安装与更新 |
| `appcast.xml` | macOS DMG URL、版本、架构和 Ed25519 签名 |
| `mac-update-build.json` | 包内版本、公钥、Sparkle 版本和测试构建标记 |
| `SHA256SUMS.txt` | 人工校验资产完整性 |

发布任务必须在创建 Release 前执行 `pnpm updates:validate <资产目录>`；同名资产不可覆盖上传。

## Windows

```powershell
pnpm package:win
pnpm smoke:packaged-desktop 'release/win-unpacked/Synapse Term.exe'
pnpm test:installer -SetupPath 'release/Synapse-Term-X.Y.Z-x64-Setup.exe' -UpgradeSetupPath 'path/to/Synapse-Term-X.Y.N-x64-Setup.exe'
```

检查安装目录选择、静默安装、覆盖升级、`--force-run` 重启、卸载数据保留和跨版本升级。跨版本测试必须传入更高版本，不能使用同版本覆盖冒充。

## macOS arm64

```bash
pnpm package:mac
pnpm smoke:packaged-desktop 'release/mac-arm64/Synapse Term.app/Contents/MacOS/Synapse Term'
pnpm updates:sign-mac
```

在 macOS 12 或更新的 arm64 环境检查 helper、framework、架构、ad-hoc 签名、DMG Ed25519 签名、公钥一致性和真实 PTY。覆盖从 GitHub Releases 手动安装 A、发现并下载版本递增的 B、下载取消、普通退出、确认过期、确认期间 Session 集合变化、缓存篡改、只读卷、从 DMG 启动、系统授权拒绝和重启后的实际版本。

安装确认前 Session 必须保持可用；确认后 Session 会结束且不恢复。确认前修改 DMG 一个字节且保持大小不变时，签名复核必须失败；重新下载后才允许继续。网络中断、Gatekeeper 或目录权限失败时，记录实际错误和人工安装入口，不宣称更新成功。

## 测试密钥与环境

CI 使用每次运行独立的测试密钥和 `SYNAPSE_UPDATE_TEST_BUILD=1`。测试资产只能作为 GitHub Actions Artifact，不能上传到正式 Release。生产私钥不得进入聊天、Git 或构建产物。

没有完成真实 macOS A→B、权限拒绝和重启验证前，不声明 macOS 真实更新链已验收；浏览器 Mock、CI 编译或单纯 DMG 构建不能替代实机结果。

完整密钥配置、资产签名和故障定位见[应用更新维护](application-updates.md)。
