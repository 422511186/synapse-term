# 安装与首次启动

本文帮助第一次使用 Synapse Term 的用户完成安装并看到第一个 Session。

## 下载

从 [GitHub Releases](https://github.com/422511186/synapse-term/releases/latest) 下载对应平台的正式安装包。

| 平台 | 正式包 | 备注 |
| --- | --- | --- |
| Windows | x64 NSIS 安装包 | 不提供 Windows arm64 正式包 |
| macOS | arm64 DMG | 最低系统版本为 macOS 12；不提供 Intel 版本 |

Release 页面中的版本、校验文件和发布说明是下载事实来源。README 和本页不固定写当前版本号。

## Windows

1. 下载 `Synapse-Term-<version>-x64-Setup.exe`。
2. 运行安装程序，选择安装目录并完成安装。
3. 启动 Synapse Term，点击「新建终端会话」。

Windows 安装程序不会因为卸载而删除全部本机应用数据；清理设置或 MCP Token 前，先阅读[本地数据边界](../reference/data-boundary.md)。

## macOS

1. 下载 `Synapse-Term-<version>-arm64.dmg`。
2. 将 Synapse Term 拖到 `/Applications` 后再启动。
3. 如果系统提示应用来自身份不明的开发者，先确认安装包来自正式 Release，再查看该 Release 中的固定 macOS 签名提示。

当前应用没有 Apple Developer ID 与公证。更新签名用于校验更新包来源，不等于 Apple 身份认证；Release 目前会说明在必要时执行：

```bash
xattr -dr com.apple.quarantine "/Applications/Synapse Term.app"
```

该命令只移除下载文件的隔离属性，不会添加开发者签名，也不能替代来源核验。固定发布说明正文见[发布正式版本](../maintainers/releasing.md)。

## 从源码运行

源码开发需要：

- Node.js `>=24.12.0 <25`
- pnpm `10.28.1`（以根 `package.json` 的 `packageManager` 为准）
- Windows 原生打包所需的 Visual Studio C++ 工具和 Windows SDK；macOS 打包需要 arm64 环境

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

只想开发 Renderer 时，可以运行：

```bash
pnpm dev
```

这会启动带 Mock API 的浏览器页面，不会启动 Electron、PTY 或真实 Shell。完整开发路径见[开发环境](../development/setup.md)。

## 下一步

- [创建第一个 Session](first-session.md)
- [首次共享 Session](share-a-session.md)
- [平台支持](../reference/platform-support.md)
