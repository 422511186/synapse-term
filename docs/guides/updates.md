# 更新 Synapse Term

## 获取更新

正式安装包会从固定的 [GitHub Releases](https://github.com/422511186/synapse-term/releases) 检查稳定版本。开发模式不联网更新；预发布、草稿和缺少当前平台完整资产的发布不会被应用接受。

你可以在通用设置中开启或关闭自动检查，也可以手动检查。发现更新不会立即安装：应用会先下载并校验固定的更新候选，再等待你的明确安装确认。

## 安装会发生什么

安装确认只对当前候选和确认时的活动 Session 集合有效，并且只能使用一次。确认前如果 Session 集合发生变化、候选被修改或确认超时，安装会被拒绝。

确认后，应用会：

1. 阻止新建 Session 和新的外部调用。
2. 停止内嵌 MCP Server，清理 Sharing 和审批。
3. 结束活动 Session。
4. 提交平台安装并重启。

Session 不会在更新后恢复。普通退出、关闭窗口或仅完成下载都不会变成安装授权。

## 安全与平台提示

- Windows 使用固定来源和包完整性校验；摘要校验不等于发布者签名。
- macOS 使用项目更新签名校验来源，但当前没有 Apple Developer ID 与公证；系统仍可能显示 Gatekeeper 或目录权限提示。
- 更新器不会自动移除 quarantine 或绕过系统授权。

安装失败时，以重启后显示的实际版本为准；不要把 Session 已结束描述为已恢复。需要手动安装时回到 [Releases](https://github.com/422511186/synapse-term/releases) 下载完整安装包。

维护者的密钥、资产和验收流程见[应用更新维护](../maintainers/application-updates.md)。
