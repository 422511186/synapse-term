## Context

当前版本为 0.5.1。`electron-builder.yml` 使用 Windows NSIS 与 macOS arm64 DMG，`.github/workflows/release.yml` 只上传安装包与 SHA256SUMS。`apps/desktop/src/main/electron-main.ts` 持有 Session runtime、MCP runtime、受限 IPC 和异步退出清理；设置工作区已有通用分类及确认操作组件。

用户确认首版需要两平台的应用内更新，但没有 Apple Developer ID 证书、公证凭据或可立即验收的 Mac。因此实现继续进行，平台验证必须按实际可用环境记录。上游支持不等于本应用已经通过 macOS 实机验证。

已发现的上下文冲突及处理：

- ADR-0004 与 `terminal-sessions` 规定关窗只分离 UI，当前 Windows 最后关窗会退出进程。本变更不借此修改一般关窗行为；任何普通退出都不获得安装授权。
- ADR-0013 与 runbook 的“不持久化数据”表述宽于已实现的本机设置。本变更明确允许更新偏好、公钥、受限更新缓存与安装结果标记，不保存 Session、终端输出、运行凭据或集中审计日志。
- 设置规格对导航的表述存在歧义。本次只在已有通用分类中增加更新区块，不新增导航结构。

## Goals / Non-Goals

**Goals:**

- 从固定的公开 GitHub 仓库发现适配 Windows x64、macOS arm64 的正式更新。
- 提供检查、下载、取消、重试、查看发布说明与明确确认后的安装重启。
- macOS 使用项目自持更新密钥，无需 Apple 开发者账号；复用成熟更新引擎的验证和安装逻辑。
- 在 Main 中协调安装、Session 与 MCP 退出，以可测试的方式拒绝过期确认和重复安装。
- 提供构建、发布和跨版本测试入口，并准确列出尚未执行的 macOS 验收。

**Non-Goals:**

- 无感强制更新、退出时或下次启动时自动安装、预发布频道、自动降级和 Session 恢复。
- 本次新增 Linux、Intel Mac 或远程更新服务。
- 移除系统安全机制、自动清除 quarantine 或声称获得 Apple 公证。
- 自行实现安装包解压替换、补丁算法或密码学。

## Decisions

### 1. Desktop Main 管理统一状态，平台 adapter 持有更新引擎

在 `apps/desktop/src/main/updates/` 中放置更新控制器与平台 adapter。共享的更新 DTO 和受限 API 放在 desktop shared 层，不向 `domain`、`session-runtime` 或 `mcp-runtime` 引入更新依赖。

```text
Settings UI --> Preload --> Main UpdateController
                                  |
                    +-------------+-------------+
                    |                           |
               Windows adapter             macOS adapter
               electron-updater         native Sparkle helper
                    |                           |
               NSIS installer              Sparkle installer
```

候选版本绑定版本号、平台、架构和引擎返回的固定产物信息；Renderer 只携带不透明候选 ID，不能指定下载 URL、安装路径、命令或 feed。来源固定为 `422511186/synapse-term`，不要求客户端 GitHub Token。平台清单和下载均保持 HTTPS；发布说明按文本或受限 Markdown 展示，不执行远程 HTML 或脚本。

Windows 直接使用与现有 electron-builder 兼容并锁定的 `electron-updater`。macOS 使用锁定的 Sparkle 2.9.6 及小型原生 adapter；上游二进制与工具在构建中校验固定摘要，保留许可文件。不升级现有 Electron 或构建工具的大版本来迁就更新能力。

### 2. macOS 使用 Sparkle 的 Ed25519 验证与显式安装接口

Sparkle 允许以旧应用内置的 Ed25519 公钥验证新发布包，无需 Developer ID。保持 DMG 为人工安装与更新共用产物，生成 `appcast.xml`，应用 Info.plist 包含 feed、公钥、禁止隐式自动安装和禁用系统画像上传的设置。启用解包前签名验证；具体 framework、helper 与 arm64 ad-hoc 签名处理由构建脚本完成并通过 macOS 构建检查。

使用 Sparkle 的 `SPUUpdater`、delegate 与自定义 user driver。核对 2.9.6 原生接口后确认：`showReadyToInstallAndRelaunch` 阶段已经允许在目标应用退出后安装，单纯持有回调或监测父进程退出不能消除竞态。因此 Main 先通过固定 HTTPS 地址下载 DMG，使用 Node 标准 `crypto.verify` 验证与 Sparkle 兼容的 Ed25519 签名，安装确认前不启动 Sparkle 的下载/提取/安装流程。只有一次性确认生效、准备复核及 Session 清理完成后，helper 才启动 Sparkle 安装，Sparkle 独立验证签名并负责替换和重启。首次就绪不声称系统授权或原生安装准备已经完成。

native helper 与 Main 以受限结构化消息通信，校验消息形态、固定版本和调用顺序；helper 不访问 Session，不开放网络控制端点，不成为常驻系统服务。确认前 helper 只执行信息检查，通信丢失直接退出，不留下等待目标应用退出的安装器。签名、公钥和固定 DMG 地址必须与 Main 已校验候选一致；安装时不能切换到更新的 Release。

该公开 API 路径可能由 Sparkle 再次下载同一 DMG，因此首版 macOS 的安装阶段可能需要额外网络传输；不使用私有 Sparkle 接口或自写文件替换来规避。后续若采用有原生下载暂存支持的成熟引擎接口，可在保持显式授权边界下优化。

未采用原样调用 `sparkle-cli --defer-install`：该参数会留下在目标应用退出后安装的进程，不满足“普通退出不能安装”的需求。也不直接使用其默认安装命令终止正在运行的终端。CLI 可以作为构建验证参考，生产安装仍必须受 Main 的确认与清理协调。

未采用自写 shell 脚本替换 `.app`：权限、符号链接、扩展属性、并发退出和失败恢复均应交给成熟安装引擎处理。

### 3. 检查、下载与安装是独立阶段

主状态为 `idle`、`checking`、`available`、`downloading`、`verifying`、`ready`、`installing`、`error` 和 `unsupported`。失败保留阶段和可执行的重试动作；检查失败与已是最新版本不同。下载取消返回可重新下载状态，不丢失运行中的 Session。

正式打包应用默认启用自动检查：启动后延迟检查，长时间运行时每 6 小时检查一次。自动检查不阻塞启动、不抢焦点；手动检查受并发合并与短时冷却保护。关闭自动检查立即停止后续调度，手动检查仍可用。开发态默认不联网自更新。

默认不自动下载，两个引擎均显式关闭退出时安装、下次启动安装及后台静默安装。下载完成可保留已验证缓存，重新启动应用后重新校验缓存与候选版本，仍需要一次新的明确安装确认。

版本比较使用成熟 SemVer 实现或已验证的引擎比较，并在发布端约束稳定版本为 `X.Y.Z`。忽略草稿、预发布、不高于当前版本及缺少当前平台完整产物的版本；不得为凑出安装包而切换到其他架构。

### 4. 安装是一次不可重放的本机确认

`getInstallImpact(candidateId)` 由 Main 返回候选版本、活动 Session 数量和一次性确认标记。`install(candidateId, confirmationId)` 验证当前候选仍已校验，Session 集合没有新增或替换，确认未过期且未消费。新的 Session 或候选变化要求重新确认；重复提交不能启动第二个安装器。

接受安装后先关闭新 Session 创建与外部调用入口，停止内嵌 MCP Server 并释放审批和 Sharing，然后通过既有 runtime 公共出口结束 Session。完成清理后才允许平台引擎提交替换并退出应用。现有 `before-quit` 清理重构为可重入、幂等的共用协调，避免 updater 的退出事件绕过清理或造成递归。

下载、签名校验和能提前完成的路径权限检查必须在结束 Session 之前完成。用户取消确认或此前检查失败时，Session 保持可用。用户确认后已经结束的 Session 不可恢复；随后发生系统授权拒绝或安装失败时，不承诺恢复 Session，也不能将失败表示为成功。启动后以实际运行版本判断是否已经更新。

### 5. GitHub Release 同时发布完整的双平台更新资产

Windows 发布 NSIS EXE、`latest.yml` 和可用的 blockmap；macOS 发布 DMG、appcast 及 Sparkle 所需签名。SHA256SUMS 保留用于人工核验。tag、根 package、desktop package、引擎清单和包内版本必须一致。

更新密钥与 Apple 证书不同。生产 Ed25519 私钥通过 CI secret 注入签名工具，不放入源代码、应用、日志或 Release；公钥进入引导版本。测试使用独立临时密钥，不能把测试公钥或占位公钥发布到正式客户端。私钥备份和生产 secret 配置在首次可更新版本发布前完成。

先生成并验证全部产物，再创建 draft Release、上传完整资产并发布。已发布的版本不通过 `--clobber` 替换更新包或其清单；修复应使用更高版本，避免用户已缓存的内容与服务器同名产物不一致。检查源与资产 URL 绑定版本，不允许安装期间无声切换到另一 Release。

### 6. 更新 UI 复用通用设置与确认组件

通用设置增加紧凑的软件更新区块：当前版本、检查时间和状态、可用版本、发布说明、自动检查开关及对应阶段的命令。后台发现更新只增加低干扰提示；安装确认展示结束 Session 的影响。系统权限提示保留平台原生交互，不能将它包装成 MCP 审批卡片。

更新偏好与本机设置一起校验保存，Windows 缓存由更新引擎管理，macOS 的确认前 DMG 缓存由 Main 限制为单个候选，安装缓存由 Sparkle 管理。仅保存恢复下载或识别安装结果所需的信息，不增加 Session 或终端输出持久化。

## Risks / Trade-offs

- 无 macOS 实机验证：仍实现原生 adapter、构建与测试入口；能运行的 CI 编译和协议检查必须执行，Gatekeeper、权限提示和真实 A 到 B 升级单独标为未验证。
- Sparkle 原生集成增加构建成本：封装在 desktop 与 macOS 构建脚本，核心校验和安装交给锁定的上游引擎。
- 未公证应用可能被系统阻止：明确展示系统确认需求，不自动删除隔离属性，不宣称完全无系统提示。
- Ed25519 私钥丢失会破坏后续更新链：正式发布前安排受保护的备份；没有其他可信签名链时，密钥丢失通过手动重装引导版本恢复。
- GitHub 不可达或限流：有界超时、单次并发检查和低频调度；失败不妨碍本地终端。
- NSIS 自定义 `customInit` 包含静默安装跳转和 `Abort`：真实安装/覆盖升级测试必须覆盖该路径，按结果修正，不能只依赖构建成功。
- 用户确认后安装失败：Session 结束不可逆，安装器尽力保持可启动应用，但不能以模拟恢复掩盖事实。

## Migration Plan

1. 实现并验证更新控制器、两平台 adapter、受限 API、设置 UI 和发布校验；不把暂缺 Mac 实机视为删除 macOS 实现的理由。
2. 生成并备份生产更新密钥，配置 CI secret，在引导版本中固定对应公钥；开发和测试使用独立密钥。
3. 现有 0.5.1 用户手动安装一次带更新器的引导版本，后续发布使用递增版本进入更新链。
4. 发布说明持续保留未获得 Apple Developer ID 签名和公证的事实，以及安装失败后的人工下载入口。
5. 遇到坏版本发布更高版本修复；不自动降级，不回放或恢复旧 Session。

## Open Questions

- 真实 macOS 桌面的 Gatekeeper、目录权限、helper 生命周期及跨版本重启尚无法验收；任务清单保留这些项，不影响继续实现。
- 首个引导版本的版本号由实际发布时确定，本次不预先更改 0.5.1 或创建 Release。

## References

- [electron-builder 自动更新](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md)
- [Sparkle 更新签名与分发](https://sparkle-project.org/documentation/#3-segue-for-security-concerns)
- [Sparkle 程序化接口](https://sparkle-project.org/documentation/programmatic-setup/)
- [sparkle-cli 的退出及安装行为](https://sparkle-project.org/documentation/sparkle-cli/)
- [Sparkle 无代码签名的验证测试](https://github.com/sparkle-project/Sparkle/blob/2.9.6/Tests/SUUpdateValidatorTest.swift)
