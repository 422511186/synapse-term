## MODIFIED Requirements

### Requirement: Blocking Approval Card for High-Risk Calls

managed 模式下需要人工裁决的调用 MUST 同步阻塞等待：Main 持 FIFO 审批队列串行向 Renderer 推送模态卡片并触发窗口抢注意力；每张卡片自展示起 60 秒超时，超时 MUST 返回 `APPROVAL_TIMEOUT`，用户点拒绝 MUST 返回 `APPROVAL_DENIED`。卡片 MUST 展示命令全文、目标会话、风险分类理由，并提供三个动作：允许一次／会话内放行该命令／拒绝。一次批准仅对当次调用生效。卡片的层级、文字、风险标签、命令区域和操作控件 MUST 使用当前 scheme 的可读颜色；普通文字与背景对比度 MUST 至少为 4.5:1，非文字控件边界和焦点指示 MUST 至少为 3:1。命令全文 MUST 在内容较长时可滚动或折叠查看，不得撑破视口或遮挡卡片操作区。

#### Scenario: User approves once

- **WHEN** 用户在卡片上点击“允许一次”
- **THEN** 该次调用继续执行并返回结果，同类后续调用仍弹卡

#### Scenario: Timeout denies

- **WHEN** 卡片展示超过 60 秒无任何用户操作
- **THEN** 对应调用返回以 `APPROVAL_TIMEOUT` 开头的错误，队列推进到下一张卡片

#### Scenario: User denies

- **WHEN** 用户在卡片上点击“拒绝”
- **THEN** 对应调用返回以 `APPROVAL_DENIED` 开头的错误，不执行命令

#### Scenario: Approval card remains readable in light scheme

- **WHEN** 当前有效 scheme 为 `light` 且 managed 模式下出现需要人工裁决的高危或未分类外部调用
- **THEN** 用户 MUST 能清楚阅读命令全文、风险理由和三个动作，且命令区域不得被半透明背景或低对比度状态色干扰

### Requirement: Local Execution Visibility

事务执行期间（自 `synapse_execute` 起，至收敛或被打断），系统 MUST 在对应会话标签显示进行中徽标并在终端面板顶部显示状态栏，标注正在被外部执行的命令与来源；状态栏 MUST 占用独立布局空间，长命令的视觉摘要不得覆盖或遮挡 Terminal Session 输出。命令全文可通过省略提示或详情交互查看。状态栏 MUST 保持信息展示性质，本地输入 MUST 保持可用，不得锁定或拦截本地键盘输入。瞬时调用（status/observe/wait 之外的短操作）不打标；wait 挂起期间标记持续。

#### Scenario: Badge shows during external execution

- **WHEN** 外部调用 `synapse_execute` 开始一个事务
- **THEN** 会话标签出现徽标、面板出现状态栏，悬停或详情查看可见命令全文与来源客户端标识

#### Scenario: Local typing stays available

- **WHEN** 外部事务执行期间用户聚焦该终端并键入内容
- **THEN** 键入正常进入 PTY，不被标记或审批拦截

#### Scenario: Long command does not obscure terminal output

- **WHEN** 外部执行中的命令长度超过状态栏可用宽度
- **THEN** 状态栏 MUST 截断或折叠命令摘要并保留可访问的完整命令，Terminal Session 的输出内容 MUST 仍可阅读
