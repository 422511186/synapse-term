# 当前构建与发布状态

本文档记录当前仓库的构建、验证和 GitHub 发布机制。它不是某个历史版本的 Release Notes，也不把本地打包文件当成已经发布的资产。

## 当前版本

- 产品名：`Synapse Term`
- 根目录版本：`0.3.3`
- 许可证：MIT
- Node.js：`>=24.12.0 <25`
- pnpm：`10.28.1`
- Electron：`43.2.0`
- Windows 构建目标：x64 NSIS 安装包
- macOS 构建目标：arm64 DMG（GitHub Actions 使用 `macos-14`）

安装文件名仍以 `Terminal-Agent-...` 开头，这是 `electron-builder.yml` 的兼容命名，不是产品名称回退。

当前命名迁移尚未覆盖所有用户可见文本：`apps/desktop/index.html` 和部分 Renderer 设置文案仍使用 `Terminal Agent`。这不影响 workspace 包名、`electron-builder` 的 `productName` 或 GitHub Release 名称，但在后续 UI 清理完成前，不能声称所有界面文字都已统一。

## 已具备的发布配置

`.github/workflows/ci.yml`：

- Pull Request 和 push 到 `main` 时运行。
- Ubuntu 上安装锁定版本依赖，执行 `pnpm verify` 和 Chromium Playwright E2E。
- push 到 `main` 时，在 Windows 和 macOS runner 上构建并上传保留 7 天的安装包 artifact。

`.github/workflows/release.yml`：

- 只响应匹配 `v*` 的 tag push。
- 先在 Ubuntu 执行 `pnpm verify`。
- 再分别构建 Windows x64 和 macOS arm64，并运行 Core/维护入口 smoke。
- 下载两端产物，生成 `SHA256SUMS.txt`。
- 使用 `gh release create --verify-tag --generate-notes` 创建正式 GitHub Release。

普通分支 push 不会创建 Release；只有 tag push 才会进入 `publish` job。Release job 需要 GitHub Actions 的 `contents: write` 权限。

## 本地验证入口

发布前至少执行：

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm build
pnpm test:e2e
```

平台打包和 smoke：

```bash
pnpm package:win:dir       # Windows
pnpm package:win           # Windows NSIS
pnpm package:mac:dir       # macOS
pnpm package:mac           # macOS DMG
pnpm smoke:core-package
pnpm smoke:maintenance-package
```

`pnpm test:installer` 只在 Windows 上验证安装生命周期。真实 Provider/SSH 验收需要用户显式提供隔离数据目录和凭据，不属于默认 CI 门槛。

## 当前状态

当前准备通过 `v0.3.3` 标签进入 GitHub Release 流程。Release 页面中的实际资产、校验文件和工作流状态，以 GitHub 上的对应 Release 为准；本地 `release/` 目录不代表远程资产。

发布前应再次确认：

- `package.json`、锁文件、README 和运行手册中的版本一致。
- 所有 CI job 通过，且 Windows/macOS 产物路径与命名匹配。
- Release 资产不包含 `core.sqlite`、`auth.token`、Provider 凭据、SSH 配置、Playwright 结果或用户数据。
- 安装包是否需要代码签名；当前工作流通过 `CSC_IDENTITY_AUTO_DISCOVERY=false` 构建，未配置产品签名证书。
- Release notes 不泄露本机路径、远端主机、SSH target、API Key 或测试 token。

## 推荐发布流程

1. 更新根目录 `package.json` 的版本，并确认 `electron-builder.yml` 使用该版本。
2. 运行 `pnpm verify`、平台打包、smoke 和需要的平台安装测试。
3. 检查 `git diff --check`、敏感信息扫描和最终产物清单。
4. 提交版本变更，推送发布分支，并通过 Pull Request 合并到 `main`。
5. 创建并推送签名格式为 `v<version>` 的 tag，例如 `v0.3.3`。
6. 在 GitHub Actions 中确认 `release.yml` 的验证、构建、SHA256 和 publish job 全部成功。
7. 在 GitHub Release 页面复核自动生成的 notes、资产和校验文件。

这份流程只描述项目机制；是否推送 tag、创建公开 Release 和修改远程仓库，必须由维护者单独确认。

## 已知限制

- 未配置产品代码签名时，Windows 和 macOS 可能显示安全警告。
- `release.yml` 使用 GitHub-hosted runner，构建结果受 runner、Electron 下载和原生模块环境影响。
- `opencode` 是 ACP 的外部运行时依赖，不随 Synapse Term 安装包发布。
- 真实 Provider、SSH 和模型验收依赖用户自己的环境，默认跳过。
- 旧的 `terminal-agent` 环境变量和数据迁移路径仍存在，删除它们需要单独设计兼容迁移。
