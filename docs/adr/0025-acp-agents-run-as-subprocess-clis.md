# ACP Agent 以子进程 CLI 运行，而非内嵌 SDK

应用内外部 Agent 作为独立 CLI 子进程启动，通过 stdio 讲 ACP（沿用 JetBrains/CursorJ 模式），而非内嵌 SDK，因此进程边界提供隔离，崩溃的 Agent 可被终止并重启。平台充当 ACP 客户端，Agent 改变状态的能力被限制在平台声明的客户端能力范围内。
