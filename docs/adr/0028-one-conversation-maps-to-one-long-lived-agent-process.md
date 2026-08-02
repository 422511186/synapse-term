# 一个 Agent Conversation 对应一个长驻 Agent 进程

每个 ACP 支撑的 Agent Conversation 拥有一个长驻 Agent 子进程，且只能由显式用户动作启动（全局 ACP 设置已启用，并在 Agent 面板选择驱动者、开始任务）；关闭对话或退出应用即终止它。进程死亡使当前轮次失败，用户重新开始新对话。
