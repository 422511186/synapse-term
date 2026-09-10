# 安全边界

本文描述 Synapse Term 的安全边界和信任假设。它面向用户、贡献者和安全审查者；操作步骤见[连接外部客户端](../guides/connect-external-client.md)，不可回退的取舍见 [ADR 索引](../adr/README.md)。

## 总体模型

Synapse Term 是单用户、本机运行的 Electron 应用。安全边界围绕 Renderer 隔离、PTY 控制权、显式 Sharing、本机 MCP 鉴权、执行前上下文和输出脱敏建立。它不承诺远程主机权限、SSH 拓扑或目标 Shell 的审计不可见性。

## Renderer 与进程隔离

Electron Renderer 在 `sandbox` 与 `contextIsolation` 下运行，`nodeIntegration` 关闭。Renderer 无法直接访问 Node API、PTY、文件系统或 Session 内部状态；所有操作必须经过 `window.synapseTerm` preload API 与 Main 的通道校验。

PTY、Session、MCP 和应用更新控制器由 Electron Main 持有。未声明的 IPC 通道一律拒绝。Renderer 崩溃或重载不会直接等同于 PTY 生命周期结束，但应用显式退出会终止全部 Session。

## MCP 鉴权与 Sharing

- 内嵌 MCP Server 默认关闭，只绑定 `127.0.0.1`，不接受远程网络连接。
- 每次请求都需要 `Authorization: Bearer <Token>`；Token 可在设置页生成、复制、轮换或吊销。
- 外部客户端只能访问用户明确 Sharing 的 Session，服务不提供 Session 枚举。
- 取消 Sharing、Session 退出、Token 吊销或服务关闭会撤销外部访问、审批和事务句柄。

Sharing 是一次明确的本机能力授予，不是远程端点、自动发布或永久授权。外部客户端仍由用户配置和控制。

## 执行与审批

结构化执行和交互启动绑定最近 `synapse_observe` 返回的 `executionContextId`。用户输入、外部提交或 PTY environment 变化后，旧上下文必须在 PTY 写入前失效；Probe 或审批等待结束后还会再次校验。这个护栏不保证远程主机权限、实际影响或回滚能力。

审批模式为 `read_only`、`managed`、`full`。高风险调用在 `managed` 下进入审批卡片，超时视为拒绝；`full` 只放行执行权，不关闭输出脱敏。交互事务的 Input Grant 独立于审批结果，并且始终是有限授权。

## 输出与敏感信息

Sharing 输出从建立时刻开始记录，不回放之前的内容。对外输出经过协议帧清理、敏感字段脱敏和有界游标分页；不提供原始 PTY 字节流、屏幕快照或跨重启历史。

完成 Probe 仍会写入当前 PTY。隐藏 Probe 回显的设置只控制本地终端 UI，不保证目标 Shell、SSH、终端或远程服务器不会记录输入。外部输入工具也不回显文本原文，但密码可能出现在 PTY 回显、终端 UI、Sharing 输出历史或审批卡片中。

## 应用更新信任

更新来源固定为 `422511186/synapse-term` 的 GitHub Releases。更新 IPC 只接受来自主窗口主 frame 的受限请求、参数类型、不透明候选 ID 和一次性确认；Renderer 不能提供 URL、feed、安装路径或命令，外部 MCP 客户端也没有应用更新能力。

Windows 使用固定 HTTPS 来源和 SHA-512 完整性校验；摘要不能称为发布者签名。macOS 使用内置 Ed25519 公钥验证 DMG；生产私钥只存在于受保护 CI，不进入应用。Sparkle 上游归档固定版本与摘要，构建保留其许可。Ed25519 更新签名和 ad-hoc 签名都不代表 Apple Developer ID 或公证。

下载完成、普通退出和应用重启不会授予安装权限。安装确认绑定固定候选和活动 Session 集合，确认前不会进入平台安装流程；安装提交后 Session 可能已经结束，更新器不承诺恢复。实现细节见[应用更新维护](../maintainers/application-updates.md)。

## 本地数据与远程环境

Session、PTY、Sharing 输出、审批队列和外部事务只在应用运行期间保留。通用设置、MCP 配置/Token、更新偏好、公钥和有限更新缓存可以本地保存；应用不上传这些数据，也不提供产品账户、远程凭据库、远程主机资产或集中审计日志。

用户在 PTY 中执行 SSH、跳板机、容器或 WSL 时，应用继续管理同一个本地 PTY，不读取或推断远程凭据、权限和连接拓扑。

## 报告问题

不要在公开 Issue、日志或 Share Text 中放置 Token、密码、真实主机信息或终端输出。提交安全问题前先移除环境敏感内容，并在 PR 中说明影响范围和可复现条件。
