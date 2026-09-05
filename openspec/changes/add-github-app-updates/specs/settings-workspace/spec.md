## ADDED Requirements

### Requirement: Application update settings
现有通用设置 SHALL 提供软件更新区块，展示当前版本、检查时间、检查结果、候选版本、纯文本发布说明、下载进度与失败状态，并提供自动检查开关及与当前状态对应的检查、下载、取消、重试和重启并更新操作。所有操作 MUST 经过 `DesktopApi.updates`。后台发现更新 SHALL 使用低干扰状态提示，不抢夺焦点。

#### Scenario: Download a discovered version
- **WHEN** 用户在通用设置查看可用更新并点击下载
- **THEN** 界面展示真实进度与取消操作，下载并验证成功后提供重启并更新

#### Scenario: Confirm session loss
- **WHEN** 用户请求重启并更新
- **THEN** 界面先取得 Main 返回的候选版本、Session 数量及确认标记，明确展示结束 Session 且不恢复的影响，取消不提交安装

#### Scenario: Surface actionable failure
- **WHEN** 检查、下载、校验、准备或安装失败
- **THEN** 界面显示对应阶段的失败和允许的下一动作，保留固定 GitHub Releases 人工下载入口

#### Scenario: Narrow settings layout
- **WHEN** 更新区块在窄窗口或亮色主题展示
- **THEN** 版本、进度、发布说明、按钮和确认内容保持可读并自动换行，不相互覆盖或超出视口
