## 1. 更新契约与状态机

- [x] 1.1 定义更新 DTO、平台 adapter 公共接口与固定 Release 来源，补充安装确认和更新缓存术语及 ADR。
- [x] 1.2 通过更新控制器公共接口测试并实现检查并发、超时、自动检查偏好、候选筛选与阶段错误。
- [x] 1.3 测试并实现显式下载、取消后的迟到事件隔离、校验就绪和一次性安装确认；覆盖 Session 集合变化、准备失败与重复提交。

## 2. 平台更新器

- [x] 2.1 锁定兼容的 electron-updater，实现 Windows NSIS adapter，固定来源与架构、关闭自动下载及退出安装，验证缓存后显式提交安装。
- [x] 2.2 实现 macOS Sparkle 原生 helper 与 Main adapter 的受限协议，提供检查、下载、取消、准备及显式安装阶段，父进程丢失时撤销未授权安装。
- [x] 2.3 增加固定摘要的 Sparkle 获取、arm64 helper 构建、framework 打包、Info.plist 公钥与必要的 ad-hoc 签名检查。

## 3. Desktop 集成与界面

- [x] 3.1 扩展 IPC 白名单与 preload API，校验更新参数和发送者，并补齐 mock 与契约测试。
- [x] 3.2 让普通退出和安装共用幂等清理；安装确认后阻止新 Session/外部调用，先清理 MCP 和 Session 再提交安装，覆盖退出竞争。
- [x] 3.3 在通用设置接入真实更新状态、进度、自动检查开关、发布说明、失败重试和 Session 结束确认，补充用户流程测试。

## 4. 构建与发布

- [x] 4.1 生成 Windows latest.yml/blockmap 与签名 macOS appcast，增加版本、资产、摘要及 Ed25519 签名一致性校验和负例测试。
- [x] 4.2 修改 Release 工作流，在两平台完整校验后 draft 上传再发布，缺少生产密钥时失败，禁止覆盖已发布资产。
- [x] 4.3 提供独立测试密钥的 macOS CI 构建验证入口与跨版本验收步骤，不依赖生产密钥运行测试。
- [x] 4.4 更新运行、安全、架构和发布文档，明确本地存储边界、引导版本迁移、未公证限制和生产密钥配置/备份步骤。

## 5. 当前环境验证

- [x] 5.1 运行 OpenSpec 校验、pnpm verify、浏览器 E2E 与 git diff --check，检查窄宽度及亮暗主题更新界面。
- [x] 5.2 在 Windows 构建并验证真实 NSIS 静默安装/覆盖升级与重启路径，记录结果及无法执行的环境限制。

## 6. 发布前外部验收

这些项目保持待验收，不阻止实现或使用独立测试密钥构建；未执行前不声明通过。

- [ ] 6.1 在 macOS arm64 运行原生编译与签名检查，并用两个递增版本验证真实下载、签名拒绝、取消、普通退出不安装、Gatekeeper/权限提示及重启。
- [ ] 6.2 发布负责人生成并备份生产 Ed25519 密钥，将私钥配置为受保护 CI secret，固定公钥，人工安装引导版本后验证正式更新链。

## 当前环境验证记录（2026-09-05）

- Windows 11、Node 24.15.0：`pnpm verify` 通过，67 个测试文件通过、1 个跳过；373 个测试通过、2 个跳过。已有 ConPTY 集成测试输出了 AttachConsole/注册表诊断，但未产生失败断言。
- `pnpm test:e2e`：23 个通过，1 个条件式真实 Electron MCP 场景跳过。检查了 1280×900 暗色安装确认与 390×844 浅色错误状态的截图。
- `openspec validate add-github-app-updates --strict` 与 `git diff --check` 通过；两个工作流和 electron-builder 配置通过 YAML 解析。
- 标准 `pnpm package:win` 在原生重编译阶段因缺少 Visual Studio C++ 工具失败。本次使用 `electron-builder --config electron-builder.yml --win nsis --x64 --publish never --config.npmRebuild=false` 和依赖自带的 Windows x64 N-API 预编译产物完成本机验证，未修改正式构建的 `npmRebuild: true`。
- 打包应用冒烟通过：Electron 43.2.0 能创建真实 PTY，更新 preload API 返回实际运行版本 0.5.1，自动检查偏好可以修改。
- 用 `--config.extraMetadata.version=0.5.2 --config.directories.output=.packaging/windows-upgrade` 生成独立测试包；仓库 package 版本仍为 0.5.1，没有创建 tag 或 Release。
- `pnpm test:installer -SetupPath release/Synapse-Term-0.5.1-x64-Setup.exe -UpgradeSetupPath .packaging/windows-upgrade/Synapse-Term-0.5.2-x64-Setup.exe` 通过：安装、升级、卸载退出码均为 0，安装版本替换为 0.5.2，`--force-run` 启动新版本进程，用户数据保留。测试目录和安装注册已清理。
- 这证明本机真实安装器的替换与重启路径，不代表生产 GitHub 更新链已经发布验收。没有 Mac 可运行 native helper，本次未执行远端 macOS CI，也未创建生产密钥。6.1、6.2 保持未完成。
