# 安全边界

Synapse Term 是单用户、本机运行的 Electron 应用。安全边界围绕 Renderer 隔离、PTY 控制权、显式 Sharing 和本机 MCP 鉴权建立；它不承诺远程主机权限、SSH 拓扑或目标 Shell 的审计不可见性。

## Renderer 隔离

Electron Renderer 在 `sandbox` 与 `contextIsolation` 下运行，`nodeIntegration` 关闭。Renderer 无法直接访问 Node API、PTY、文件系统或 Session 内部状态；所有操作必须经过 `window.synapseTerm` preload API 与 Main 的通道校验。

## 进程边界

PTY、Session 和 MCP 控制器由 Electron Main 持有。即使 Renderer 崩溃或重载，PTY 仍继续运行；Main 只向 Renderer 暴露白名单中的会话、终端、设置、主题和 MCP 控制通道，未声明的 IPC 通道一律拒绝。

## MCP 服务

- 内嵌 MCP Server 默认关闭，只绑定 `127.0.0.1`，不接受远程网络连接。
- 每次请求都需要 `Authorization: Bearer <Token>`；Token 可在设置页生成、复制、轮换或吊销。
- 外部客户端只能访问用户明确共享的 Session，服务不提供 Session 枚举；取消 Sharing、Session 退出或 Token 吊销会撤销访问。
- `read_only`、`managed`、`full` 三档审批模式控制外部调用；`full` 只改变执行授权，不关闭输出脱敏。
- 结构化执行绑定最近观察到的 `executionContextId`；用户输入或 PTY 环境变化后，旧上下文必须在写入前失效。

## 输出与敏感信息

Sharing 输出从共享建立后开始记录，不回放共享前内容。对外输出经过协议帧清理和敏感字段脱敏，并通过有界游标分页读取；不提供原始 PTY 字节流、屏幕快照或跨重启历史。

完成 Probe 仍会写入当前 PTY。隐藏 Probe 回显的设置只控制本地终端 UI，不保证目标 Shell、SSH、终端或远程服务器不会记录该输入。外部输入工具也不回显文本原文，但密码可能出现在 PTY 回显、终端 UI、Sharing 输出历史或审批卡片中。

## 本地数据

Session、PTY 和 Sharing 输出历史只在应用运行期间保留，应用退出时释放。MCP 端口、审批模式和访问 Token 由本机设置存储管理，不上传到服务端；应用不提供产品账户、远程凭据库、远程主机资产或集中审计日志。

## 本地 Shell 与远程环境

Shell 发现只枚举本机可用 Shell 并返回路径/参数；Main 使用桌面进程继承的环境合并启动配置后创建 PTY。用户在 PTY 中执行 SSH、跳板机、容器或 WSL 时，应用继续管理同一个本地 PTY，不读取或推断远程主机凭据、权限和连接拓扑。
