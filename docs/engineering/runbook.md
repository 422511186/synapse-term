# 运行手册

## 环境要求

- Node.js `>=24.12.0 <25`：切换前先 `nvm ls` 检查本机版本，优先 `nvm use` 已安装的满足版本；缺失时执行 `nvm install 24.12.0`。
- pnpm `10.28.1`（以根目录 `package.json` 的 `packageManager` 为准）：`corepack enable` 后安装依赖。
- Windows 标准打包会重新编译原生依赖，需要 Visual Studio 的 C++ 桌面开发工具与 Windows SDK。缺少工具时的本地预编译产物验证不能替代正式构建环境。

## 开发

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev        # Mock Renderer（浏览器）
pnpm build      # 构建 desktop
pnpm start      # 启动真实 Electron
```

## 验证

```bash
pnpm verify         # format:check + lint + typecheck + test
pnpm test:coverage  # Vitest 覆盖率报告
pnpm test:e2e       # Playwright 浏览器 E2E（依赖 pnpm dev 的 Mock 模式）
```

## 打包

```bash
pnpm package:mac
pnpm package:mac:dir
pnpm package:win
pnpm package:win:dir
pnpm smoke:packaged-desktop "release/mac-arm64/Synapse Term.app/Contents/MacOS/Synapse Term"
pnpm icons:generate   # 从 SVG 重新生成 build/icon.png 与 icon.icns（macOS）
```

产物位于 `release/`，命名统一为 `Synapse-Term-<version>...`。

macOS 打包需要 `SPARKLE_PUBLIC_KEY`，使用原生 macOS arm64 构建环境；正式 DMG 签名另外需要受保护的 `SPARKLE_PRIVATE_KEY`。CI 使用独立测试密钥，不需要 Apple Developer ID 或公证凭据。密钥配置、产物校验和平台验收见 [应用更新手册](app-updates.md)。

## 数据

本应用不持久化 Session、终端输出、运行凭据或集中审计日志。Electron `userData` 下保存通用设置、本机 MCP 配置与访问 Token、更新偏好及有限更新缓存；更新公钥随应用打包。旧 `terminal-agent` 数据目录不再读取。不要把整个用户数据目录当作可随意删除的缓存，清理前先确认设置和本机 MCP Token 的影响。

## 故障处理

- Renderer 白屏：查看 DevTools Console；确认 `pnpm build` 产物存在或 `SYNAPSE_TERM_RENDERER_URL` 指向开发服务器。
- Session 创建失败：检查 Shell 是否可用、工作目录是否存在。
- PTY 意外退出：UI 会将该 Session 标记为 `exited`/`interrupted`，可关闭后重建。
- 更新失败：在通用设置查看失败阶段，确认 GitHub 连通性和 Release 资产完整；校验失败重新下载，安装失败以重启后的实际版本为准。更新器不会恢复 Session。
