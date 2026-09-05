## ADDED Requirements

### Requirement: Complete immutable release assets
发布流程 SHALL 在创建可见正式 Release 前构建并校验 Windows NSIS EXE、`latest.yml`、blockmap、macOS arm64 DMG、`appcast.xml` 以及 `SHA256SUMS.txt`。tag、根与 desktop 包版本、更新清单版本和安装包版本 MUST 一致。正式发布的安装包和清单 MUST NOT 使用覆盖上传修改。

#### Scenario: Publish a valid release
- **WHEN** 两平台产物及版本、摘要、签名检查全部通过
- **THEN** 流程创建 draft Release，上传完整产物并最终发布

#### Scenario: Reject an incomplete release
- **WHEN** 任一平台缺少资产、清单指向不存在文件或版本不一致
- **THEN** 流程在发布正式 Release 前失败，不产生可见的不完整更新

### Requirement: Project-owned macOS update signature
macOS 更新 SHALL 使用项目自持的 Ed25519 私钥对最终 DMG 签名，并在引导版本内固定对应公钥。生产私钥 MUST 只通过受保护的 CI secret 注入，不得进入源码、应用、日志或发布资产；缺少生产配置 MUST 阻止正式发布。测试密钥与生产密钥 MUST 分离。

#### Scenario: Missing production key
- **WHEN** 正式发布没有生产私钥或对应公钥
- **THEN** 流程明确失败，不使用占位或测试密钥继续发布

#### Scenario: Verify a signed update
- **WHEN** 客户端下载与旧版本内置公钥对应的已签名 DMG
- **THEN** Sparkle 验证签名后才允许安装；篡改内容或其他密钥的签名必须被拒绝

### Requirement: Pinned native update dependencies
构建 SHALL 固定 Sparkle 版本与上游归档摘要，保留许可，并构建与应用架构匹配的原生适配；依赖下载或摘要验证失败 MUST 阻止 macOS 更新器打包。

#### Scenario: Upstream archive changed
- **WHEN** 下载的 Sparkle 归档摘要不匹配固定值
- **THEN** 构建停止且不得执行归档中的工具

### Requirement: Bootstrap and platform acceptance
发布文档 SHALL 说明无更新器版本需手动安装一次引导版本、项目没有 Apple Developer ID 签名和公证、更新不恢复 Session，以及生产密钥备份与恢复方式。macOS 暂无真机 MUST 不阻止实现；尚未执行的 Gatekeeper、权限提示与真实跨版本重启验收 MUST 明确保持待验证。

#### Scenario: Upgrade from version without updater
- **WHEN** 用户运行 0.5.1 或其他不含更新器的版本
- **THEN** 文档指引手动安装引导版本，之后才进入应用内更新链

#### Scenario: Report unexecuted Mac validation
- **WHEN** 当前环境无法运行 macOS 实机验收
- **THEN** 交付包含实现、macOS 构建验证入口及待执行步骤，不得把 mock 或上游测试报告为项目实机通过
