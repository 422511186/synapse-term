# 平台支持

## 正式安装包

| 平台 | 架构 | 分发方式 | 当前边界 |
| --- | --- | --- | --- |
| Windows | x64 | NSIS 安装包 | 需要受支持的 Windows x64 环境；没有 Windows arm64 正式包 |
| macOS | arm64 | DMG | 最低 macOS 12；没有 Intel 正式包；当前没有 Apple Developer ID 与公证 |

正式资产和校验文件以 [GitHub Releases](https://github.com/422511186/synapse-term/releases) 为准。不要从 `release/` 目录或 CI Artifact 推断正式支持范围。

## 源码开发

- Node.js：`>=24.12.0 <25`
- pnpm：`10.28.1`
- Windows 原生打包：Visual Studio C++ 桌面开发工具和 Windows SDK
- macOS 打包：原生 arm64 环境；需要 `SPARKLE_PUBLIC_KEY`，正式签名还需要受保护的 `SPARKLE_PRIVATE_KEY`

浏览器 Mock 模式可以在其他开发环境用于 Renderer 交互，但它不证明 Electron、PTY、安装器或平台更新链可用。

## Session 与远程环境

SSH、跳板机、容器和 WSL 不是单独的平台资产。它们在当前本地 PTY 中运行，Synapse Term 不提供远程主机枚举、凭据管理或连接拓扑恢复。
