# 安全边界

## 信任模型

Synapse Term 是当前操作系统用户（Windows/macOS）范围内的单用户本地产品。它约束的是模型驱动的终端和本机文件操作，防止模型越过 Session、Tool、路径、凭据和审批边界；它不替代远端服务器自身的最小权限、SSH 密钥管理、操作系统隔离或企业级策略中心。

用户仍可直接在终端中执行任意命令。远端 Shell、终端输出和本机文件内容均视为不可信数据，不能覆盖系统提示、用户目标或 Core 的本地策略。

## 进程与凭据隔离

- Renderer 开启 sandbox 和 context isolation，关闭 Node integration 和原生菜单栏。
- preload 只暴露 Session、terminal、Agent、Provider、model、resource、audit 和 Core 的窄接口。
- Core Named Pipe 使用当前用户作用域名称、认证令牌、challenge 和协议版本握手。
- Core 数据目录、数据库、原始日志和认证令牌限制为当前用户（Windows 使用 ACL，macOS 使用 POSIX 权限）。
- Provider API Key 只保存到平台凭据存储（Windows Credential Manager / macOS Keychain）；SQLite 只保存 credential reference。
- Renderer、审计 payload、模型发现结果和错误信息都不得接收密钥值或原始 Authorization header。

## Terminal Tool 安全

`terminal_execute` 在写入 PTY 前依次执行：Tool Schema 校验、Session/Turn 绑定、方言能力 Probe、JIT Lease、命令风险分类、Permission Mode 决策和精确审批。

命令风险为：

| 风险 | 说明 |
| --- | --- |
| `read_only` | 本地规则能够确定为只读观察 |
| `mutating` | 普通修改或副作用 |
| `unknown` | 解析失败、语义不明确或无法证明安全 |
| `privileged` | 提权、敏感配置或高权限操作 |
| `destructive` | 删除、覆盖、大范围或高影响操作 |

模型自报标签不能降低 Core 的风险结果。Approval Grant 绑定 Conversation、Turn、Tool Call、Session、完整命令、风险和命令哈希；命令文本、顺序、Session 或 Lease epoch 改变都会使授权失效。交互式密码、验证码、TUI、pager、编辑器和任意按键提示交给用户接管，Agent 不获得通用 `send_keys`。

## Permission Mode

| 模式 | 确定只读 | 普通修改 | unknown / privileged / destructive |
| --- | --- | --- | --- |
| `manual` 人工审批 | 自动执行 | 请求审批 | 请求审批 |
| `auto` 自动审批 | 自动执行 | 自动执行并审计 | 请求审批 |
| `full_access` 完全权限 | 自动执行 | 自动执行 | 自动执行并记录高风险 |

完全权限只移除审批提示，不扩大能力。所有模式始终保留：九个 Tool allowlist、当前 Session 绑定、用户 home canonical path、参数 Schema、SecretRedactor、expected SHA-256、Lease epoch、ShellDriver 和审计。活动审批不会因切换模式而自动获批，新模式只影响后续 Tool Call。

## 本机文件边界

Local File Tool 始终以操作系统动态解析的当前用户 home 为唯一根目录。仅接受相对路径，并在访问前后校验 canonical path；绝对路径、UNC、设备路径、ADS、NUL、`..`、symlink、junction 和 reparse point 逃逸均 fail closed。

普通读取为 `read_only`；普通 write/edit 为 `mutating`。以下路径或内容至少提升为 `privileged`：

- `.ssh`、`.aws`、`.azure`、`.kube`、gcloud、Docker、npm、PyPI 等凭据配置
- `.env*`、浏览器 Profile、私钥、Token、密码和 Secret 特征
- 启动项与 Shell Profile 修改（Windows Startup、PowerShell Profile 等）提升为 `destructive`

写入和编辑必须满足操作模式、expected SHA-256 和精确编辑匹配，先在内存构造完整结果，再同目录原子替换。审批绑定相对路径、操作、预期哈希和完整 Diff。首版没有 delete、move、chmod、注册表或任意本机进程 Tool。

## 上下文与秘密披露

- 新 Turn 不默认包含终端屏幕或文件内容；模型必须显式调用 Tool。
- Protected Input 不进入模型上下文、输入日志或审计 payload。
- 终端输出和文件内容发送给模型前经过 SecretRedactor；本地终端与经授权 Diff 仍可显示原始内容。
- Context Compaction 摘要同样先脱敏；原始 Model Item 保留在本地数据库，不自动发送给 Provider。
- Provider 流产生首个事件后不做隐式重试，避免重复 Tool Call 或副作用。

## 资源快照

资源刷新必须由用户显式触发，只能在当前 Ready、空闲且非交互状态的 Session 中执行。Core 使用固定只读命令、`read_only` 风险和独立 ShellDriver；不接受模型提供资源采集命令，也不创建 SSH 或服务器资产对象。

每次刷新记录 Session、方言、时间、结果、已采集字段和 `fixed_command` 只读策略，不长期保存完整原始采集输出。部分命令缺失时指标标为不可用，不伪造零值。

## 审计与保留

结构化审计追加记录 actor、Session、Conversation、Turn、Tool Call、权限模式、策略判断、授权、命令哈希、文件前后 SHA-256、资源刷新、中断、接管、时间、退出状态和错误。完整终端字节流不是长期审计。

- 活动 Session 原始日志默认每 Session 64 MiB、全局 1 GiB
- Session 结束后原始日志默认保留 24 小时
- 结构化审计默认保留 30 天
- headless terminal 默认保留 10,000 行 scrollback

## 非目标与残余风险

- Core 崩溃、升级或系统重启会终止 PTY，不承诺恢复正在运行的远程 Shell。
- 自动秘密检测可能漏报或误报，不能替代远端最小权限和凭据轮换。
- 当前安装包未配置 Authenticode 时，Windows 会显示未签名警告。
- 当前用户本人仍可绕过 Agent，在终端或文件系统中直接操作；产品安全边界只约束 Agent 驱动的能力。

## 明文执行审计要求

所有 Agent 生成的 Shell 命令必须以明文形式写入 PTY，服务器侧审计（堡垒机、会话录像、命令白名单、Shell history）必须能在执行前看到原始命令。系统禁止以下编码后动态执行模式：

- POSIX: `base64 -d`、`eval` 解码变量、命令替换中的 base64 解码
- PowerShell: `FromBase64String`、`[ScriptBlock]::Create`、`EncodedCommand`、`Invoke-Expression`

非执行数据编码（认证握手、日志序列化、资源字段编码）中的 Base64 仍然允许，但不得流入命令执行器。

### 方言验证

Session 的执行方言从"创建时本地 Shell 属性"收紧为"当前 PTY 环境经验证的能力"。SSH、容器、WSL 或嵌套 Shell 切换后必须重新验证。验证通过固定明文指纹和方言特定 Probe 完成，不猜测远端环境。

### Fail-closed 策略

以下情况系统拒绝执行并保持 observation-only：

- 环境未验证或 capability epoch 过期
- 命令包含控制字符、事务边界标记或 OSC 777 序列
- 无法构造语义等价的明文事务
- 事务完成事件缺失或 nonce 不匹配
- PTY 写入被拒绝

拒绝时返回稳定错误码（`execution_environment_unverified`、`command_not_auditable`、`plaintext_protocol_error`），不会静默回退到编码 wrapper。

### 迁移与兼容性

旧 Session 的启动方言降级为 unverified hint，Core 重启后旧活动 Session 标记为 `interrupted + unverified`。受影响服务器不得回滚到会重新启用 Base64 wrapper 的版本。
