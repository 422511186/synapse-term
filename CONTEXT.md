# Synapse Term

本地优先的桌面终端。用户在应用内准备本地 Shell、SSH、跳板机、容器或 WSL 终端会话；应用持有 PTY 与实时输出，并可通过内嵌 MCP Server 把已共享会话的能力提供给本机外部客户端。

## Language

### 终端与会话

**会话（Session）**:
一个由应用持有的 PTY 终端实例，具有独立生命周期。
_Avoid_: 标签页、连接

**共享（Sharing）**:
用户通过复制会话 ID 把某个会话显式开放给外部客户端的动作；未共享的会话对外部客户端不存在。
_Avoid_: 发布、暴露、连接

**共享文本（Share Text）**:
执行共享时写入剪贴板的预置提示词块：包含会话 ID、可用工具清单与连接前提说明，供用户整段粘贴给外部客户端；另提供仅复制裸 ID 的次级动作。
_Avoid_: 分享链接、邀请码

### MCP 接入

**内嵌 MCP Server**:
运行于 Electron Main、只监听本机回环地址的 MCP 服务端，向外部客户端提供终端工具。
_Avoid_: MCP 客户端（那是对方的角色）、远程端点

**外部客户端（External Client）**:
通过 MCP 连接本应用的本机程序（如 Codex）。
_Avoid_: Agent、AI 助手

**外部调用（External Call）**:
外部客户端经 MCP 发起的单次工具调用，必须携带已共享的会话 ID。
_Avoid_: 远程请求

### 权限与审批

**审批模式（Approval Mode）**:
外部调用的基础策略档位，共三档：`read_only` 只放行观察类调用；`managed` 额外自动放行低危调用，其余交由人工审批；`full` 不做风险审查全部放行。配置缺失或损坏时回退 `read_only`。
_Avoid_: 权限等级、安全模式

**审批卡片（Approval Card）**:
高危外部调用触发的同步人工确认界面；一次批准只对当次调用生效，超时视为拒绝。
_Avoid_: 弹窗、确认框

**会话内放行（In-session Grant）**:
审批卡片上可授予的会话范围记忆：同一命令全文在本会话内的后续调用自动通过，随会话关闭而消失，不持久化。
_Avoid_: 白名单、永久授权

**风险分类（Risk Class）**:
对外部命令的自动分级：观察、低危、高危（含特权与破坏性）与未分类。
_Avoid_: 权限、严重度

### 当前 PTY 环境与诊断显示

**当前 PTY 环境（Current PTY Environment）**:
由当前 Session 的 PTY 通过固定 Probe 验证得到的 Shell 方言和平台事实；启动时的 Shell 提示只是 hint，环境变化后由 capability epoch 失效。
_Avoid_: 远程连接对象、SSH 连接、服务器资产

**完成探针回显可见性（Completion Probe Echo Visibility）**:
只控制完成探针输入回显是否显示在本地终端 UI 的通用设置；不控制探针是否写入 PTY，也不承诺目标 Shell、SSH 或远程服务器审计设施不可见。
_Avoid_: 远程隐藏、审计关闭、禁发探针
