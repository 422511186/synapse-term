# 排查常见问题

先确认应用和 Session 的当前事实，再决定是否重试。对于外部事务，`unknown` 和写入不确定态都不应自动重放。

| 现象 | 处理 |
| --- | --- |
| Renderer 白屏 | 打开 DevTools Console；确认 `pnpm build` 产物存在，或 `SYNAPSE_TERM_RENDERER_URL` 指向可访问的开发服务器。 |
| 没有可选 Shell | 确认 Shell 已安装且路径可执行；重新打开新 Session 让应用重新发现本机环境。 |
| Session 创建失败 | 检查工作目录和 Shell 参数；关闭失败 Session 后重新创建。 |
| PTY 意外退出 | 当前 Session 会显示 `exited` 或 `interrupted`；不要假设远程进程状态，关闭后创建新的 Session。 |
| MCP 端点无法连接 | 确认桌面端已启用 MCP 服务、地址使用 `127.0.0.1`、端口与设置页一致，并使用最新 Token。 |
| 外部客户端看不到 Session | 重新确认目标 Session 仍处于 Sharing；取消后重新 Sharing 会生成新的输出边界和 Share Text。 |
| 返回 `EXECUTION_CONTEXT_STALE` | 停止提交命令，调用 `synapse_observe`（必要时 `tail: true`）获取新的 `executionContextId`。 |
| 返回 `SESSION_NOT_READY` | 等待当前 Shell/SSH/嵌套 Shell 提示符稳定；不要循环调用 `synapse_status` 或盲目重试。 |
| 返回 `APPROVAL_TIMEOUT` 或 `APPROVAL_DENIED` | 检查审批模式和用户裁决；重新提交前确认命令仍符合当前意图。 |
| 返回 `INPUT_WRITE_UNKNOWN` 或 `INTERACTIVE_START_WRITE_UNKNOWN` | 不要自动重放密码、按键或启动命令；先重新观察并让用户判断可能已经发生的影响。 |
| 更新失败 | 确认网络和 Release 资产完整；重新下载并以重启后的实际版本判断结果。更新不会恢复已结束的 Session。 |

## 需要报告安全问题

不要在公开 Issue、日志或 Share Text 中放置 Token、密码、真实主机信息或终端输出。安全边界和敏感信息处理见[安全边界](../security/security.md)；报告前先移除环境敏感内容。
