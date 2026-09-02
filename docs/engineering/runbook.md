# 运行手册

## 环境要求

- Node.js `>=24.12.0 <25`：切换前先 `nvm ls` 检查本机版本，优先 `nvm use` 已安装的满足版本；缺失时执行 `nvm install 24.12.0`。
- pnpm `10.28.1`（以根目录 `package.json` 的 `packageManager` 为准）：`corepack enable` 后安装依赖。

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

## 数据

本应用不做持久化。旧版本遗留的 `~/Library/Application Support/synapse-term` 与 `terminal-agent` 数据目录不再读取；如确需清理可手动删除。

## 故障处理

- Renderer 白屏：查看 DevTools Console；确认 `pnpm build` 产物存在或 `SYNAPSE_TERM_RENDERER_URL` 指向开发服务器。
- Session 创建失败：检查 Shell 是否可用、工作目录是否存在。
- PTY 意外退出：UI 会将该 Session 标记为 `exited`/`interrupted`，可关闭后重建。
