# 安全边界

## Renderer 隔离

Electron Renderer 在 `sandbox` 与 `contextIsolation` 下运行，`nodeIntegration` 关闭。Renderer 无法直接访问 Node API、PTY、文件系统或 Session 内部状态；所有操作必须经过 `window.terminalAgent` preload API 与 Main 的通道校验。

## 进程边界

PTY 由 Electron Main 持有。即使 Renderer 崩溃或重载，PTY 仍继续运行；Main 只向 Renderer 暴露受限的会话/终端/状态通道，未声明的 IPC 通道一律拒绝。

## 数据

应用不写 SQLite、不写日志文件、不保存密钥；Session 全部在内存中，应用退出即释放。无持久化数据意味着没有可被离线窃取的凭据或历史。

## 本地 Shell

Shell 发现只枚举本机可用 Shell 并返回路径/参数；Main 使用桌面进程继承的环境合并启动配置后创建 PTY。应用不读取远程主机凭据。
