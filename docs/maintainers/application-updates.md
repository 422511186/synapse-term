# 应用更新维护

本文面向发布负责人、更新链维护者和 QA。用户可见的更新行为见[更新 Synapse Term](../guides/updates.md)，不可回退的信任取舍见 [ADR-0021](../adr/0021-explicit-github-application-updates.md)。

## 更新实现边界

- 正式 Windows x64 与 macOS arm64 应用从固定公开仓库检查稳定版本；开发模式不联网更新。
- 自动检查默认在启动 15 秒后执行，随后每 6 小时检查一次；手动检查会合并并发请求，30 秒内限制重复检查，网络检查超时为 30 秒。
- 发现更新不会自动下载；下载完成后仍须用户明确确认安装。通用设置中的自动检查开关会持久保存。
- Windows 使用 NSIS 与 `electron-updater`，依赖固定来源和 SHA-512 完整性校验；没有产品签名证书时，摘要不能称为发布者签名。
- macOS 使用 Sparkle 2.9.6 与项目自持 Ed25519 更新密钥。Main 在安装确认前下载并验证 DMG，helper 会拒绝只读卷（包括直接从 DMG 运行）；确认并清理 Session 后才启动 Sparkle 原生安装流程，因此可能发生第二次下载。
- 下载、普通退出和应用重启不会授予安装权限；安装确认有效期为 60 秒，绑定固定候选和确认时的活动 Session 集合，只能使用一次。准备期间新增或替换 Session、确认过期或包被修改都会拒绝安装。
- 更新器不进入 Session 或 MCP runtime，不持久化 Session、终端输出、运行凭据或可重放的安装授权。

## 生产密钥

私钥不要发到聊天、提交到 Git 或上传为构建产物。首个可更新版本前：

1. 在 GitHub 仓库创建受保护的 `release` Environment。
2. 使用仓库脚本生成 32 字节 seed 格式的 Ed25519 密钥，并把私钥和 `.pub` 文件备份到受保护的离线存储或密码管理器。
3. 将私钥配置为 `SPARKLE_PRIVATE_KEY` Secret，将公钥配置为 `SPARKLE_PUBLIC_KEY` Variable；不要把私钥放入命令参数。
4. 用[发布正式版本](releasing.md)发布带同一公钥的引导版本，并在真实 macOS arm64 环境完成至少一个递增版本的验收。

示例：

```powershell
$keyDirectory = Join-Path $env:USERPROFILE '.synapse-term-update-keys'
New-Item -ItemType Directory -Path $keyDirectory -Force | Out-Null
$keyFile = Join-Path $keyDirectory 'production-ed25519.key'
pnpm updates:keys $keyFile
```

```powershell
Get-Content -LiteralPath $keyFile -Raw | gh secret set SPARKLE_PRIVATE_KEY --env release --repo 422511186/synapse-term
gh variable set SPARKLE_PUBLIC_KEY --env release --repo 422511186/synapse-term --body ((Get-Content -LiteralPath "$keyFile.pub" -Raw).Trim())
```

不能随意重新生成生产密钥。密钥泄露时暂停发布并人工迁移；不要用同一失信密钥恢复信任。

私钥不会打包进应用，公钥写入主应用 `Info.plist`。没有 Developer ID 作为另一条信任链时，私钥丢失可能需要用户手动安装含新公钥的引导版本。

## 构建和校验

```bash
pnpm package:win
pnpm package:mac
pnpm updates:validate <资产目录>
```

构建脚本会校验上游归档摘要、包内版本、公钥、架构和签名配置。完整资产清单和平台动作见[发布与更新验收](release-validation.md)。浏览器 E2E 或 CI 编译不能替代真实安装、Gatekeeper、系统授权和跨版本更新验收。

上游工具版本和 SHA-256 摘要固定后才执行；签名工具通过标准输入读取私钥，错误输出不得转发到构建日志。

## 故障处理

- 检查失败：确认固定 GitHub 来源、网络、API 限流和平台资产完整。
- 包校验失败：重新下载；正式 Release 不通过覆盖文件修复。
- 安装提交后失败：以重启后的实际版本判断结果，从 Releases 手动安装更高版本；已结束的 Session 不会恢复。
- 私钥丢失或泄露：暂停发布，保留事件记录并制定新的引导安装路径。

更新偏好位于 Electron `userData/settings/updates.json`；macOS 确认前缓存位于 `userData/updates/download-*`，单包限制 512 MiB，取消或普通退出会清理当前暂存包，下次下载会清理遗留暂存目录；Windows 使用 `electron-updater` 的缓存目录，安装前重新校验内容。任何缓存都不保存 Session、输出、凭据或安装授权。
