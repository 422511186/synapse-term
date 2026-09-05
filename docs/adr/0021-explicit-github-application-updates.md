# ADR-0021：GitHub 应用更新与明确安装授权

状态：已接受

Windows 使用 NSIS 与 electron-updater，macOS 使用 Sparkle 2 和项目自持 Ed25519 更新签名。项目没有 Apple Developer ID 与公证条件；Ed25519 只验证更新包来源，不代表 Apple 信任或免除系统授权。生产私钥须备份并保存在受保护 CI secret 中，客户端仅内置公钥；密钥丢失时可能需要用户手动安装新的引导版本。

更新由 Desktop Main 管理，Renderer 仅通过受限 preload API 请求。更新不进入 Session 或 MCP runtime，也不成为外部工具。安装确认绑定固定候选和当前活动 Session 集合，只能使用一次；先阻止新 Session 和外部调用，清理 MCP 与 Session，再提交安装。Session 不跨重启恢复。

Sparkle 在原生提取与安装准备阶段可能在应用退出时自动安装。因此 macOS 在确认前由 Main 下载固定 DMG，并用标准密码库验证 Ed25519 签名；确认并清理 Session 后才启动 Sparkle 的安装流程，由 Sparkle 再次验签、替换并重启。接受可能重复下载的代价，以避免未授权安装，不使用私有更新接口或自写应用替换脚本。普通退出不能变成安装授权。

本决策澄清 ADR-0013 的存储边界：允许本机设置、更新公钥和有限更新缓存；仍不持久化 Session、终端输出、运行凭据或集中审计日志。现有 MCP 本机访问 Token 的既定存储不因此扩展为远程凭据库。
