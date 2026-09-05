## ADDED Requirements

### Requirement: Stable GitHub version discovery
Main SHALL 从固定公开仓库 `422511186/synapse-term` 的正式 Release 发现适配 Windows x64 或 macOS arm64 的更高稳定版本，使用成熟版本比较和更新引擎。客户端 MUST NOT 需要 GitHub Token，MUST NOT 接受 Renderer 指定 feed、URL、安装路径或命令。

#### Scenario: Discover a compatible release
- **WHEN** 当前平台存在版本高于运行版本且更新资产完整的正式 Release
- **THEN** 应用显示该候选版本和作为纯文本展示的发布说明

#### Scenario: Ignore incompatible releases
- **WHEN** Release 是草稿、预发布、不高于当前版本或缺少当前平台资产
- **THEN** 系统 MUST NOT 将其作为可安装候选，MUST NOT 使用其他架构的安装包

### Requirement: Bounded automatic and manual checks
正式打包应用 SHALL 默认在启动后延迟自动检查，并每六小时检查一次；用户 SHALL 能关闭后续自动检查并继续手动检查。检查 MUST 合并并发请求、限制短时重复请求并具有超时。开发态和不支持的平台 MUST 不自动联网或安装。

#### Scenario: Disable automatic checks
- **WHEN** 用户关闭自动检查并重新启动应用
- **THEN** 应用保留该偏好，不自动检查，仍提供手动检查

#### Scenario: Network check fails
- **WHEN** GitHub 不可达、限流或检查超时
- **THEN** 系统显示可重试的检查失败，MUST NOT 把失败表示为已是最新版本，也不得影响 Session

### Requirement: Explicit download and verified readiness
发现更新后应用 SHALL 等待用户下载，提供进度、取消和重试，并仅在完整性验证完成后进入可请求安装状态。Windows SHALL 使用 NSIS 与 `electron-updater` 的完整性验证；macOS SHALL 使用标准密码库验证 Sparkle Ed25519 签名，明确确认后再由 Sparkle 独立验签和安装。下载状态与安装授权 MUST 相互独立，macOS 确认前 MUST NOT 启动允许退出时自动安装的 Sparkle 提取或安装阶段。

#### Scenario: Cancel a download
- **WHEN** 用户取消下载
- **THEN** 应用回到可重新下载状态，Session 继续运行，迟到的下载事件不得使已取消操作变为可安装

#### Scenario: Verification fails
- **WHEN** 安装包摘要或签名不匹配
- **THEN** 应用拒绝安装，显示校验失败并允许重新下载，MUST NOT 结束 Session

#### Scenario: Ordinary application exit
- **WHEN** 安装包已下载而用户普通关窗、退出或重新启动应用
- **THEN** 系统 MUST NOT 隐式安装；任何复用的缓存必须重新验证且仍需要新的明确安装确认

### Requirement: One-time installation confirmation
Main SHALL 返回绑定候选版本与当前活动 Session 集合的一次性确认标记，并显示安装会结束的 Session 数量。安装 MUST 拒绝过期、重复、版本变化或 Session 集合变化后的确认。

#### Scenario: Sessions change during confirmation
- **WHEN** 确认界面打开后新增或替换 Session，再提交旧标记
- **THEN** Main 拒绝安装并要求重新确认，现有 Session 继续运行

#### Scenario: Confirm and install
- **WHEN** 用户提交有效确认且所有可提前完成的准备检查成功
- **THEN** Main 关闭新 Session 和外部调用入口，停止内嵌 MCP Server、清理 Sharing 与审批并结束 Session，随后才允许更新引擎提交安装重启

#### Scenario: Installation fails after shutdown
- **WHEN** Session 结束后系统授权被拒绝或安装器失败
- **THEN** 应用 MUST 报告失败且不得声称恢复 Session；实际更新结果以重新启动后运行版本为准

### Requirement: Local update storage boundary
系统 SHALL 仅保存更新偏好、公钥、受限更新缓存及判断安装结果所必需的版本信息，MUST NOT 持久化 Session、终端输出、运行凭据或集中审计日志。缓存不得代替当前候选与签名校验。

#### Scenario: Restart with cached package
- **WHEN** 应用重新启动并存在旧更新缓存
- **THEN** 应用仅在重新检查候选和校验缓存后允许安装，且不恢复此前的安装确认或 Session
