## 1. 失败契约与回归基线

- [x] 1.1 为 `terminalType` 的协议校验、Session 持久化/重建和摘要返回添加失败单元测试。
- [x] 1.2 为超长 macOS 临时目录下的短 IPC endpoint、Core/Desktop 一致性和 Windows Named Pipe 兼容性添加失败单元测试。
- [x] 1.3 为完整 `DesktopApi` 通道映射、`session.changed` 事件转发和未声明通道拒绝添加失败契约测试。
- [x] 1.4 为新建标签、真实终端类型、20 个会话的标签溢出/搜索/关闭和活动 xterm 切换添加失败浏览器 E2E。
- [x] 1.5 为实际 Electron/Core 本地 Session 生命周期添加失败集成冒烟场景，覆盖 status、Shell 发现、创建、终端 IO/replay、资源和关闭。

## 2. 协议、Core 与真实 IPC

- [x] 2.1 实现共享且有 POSIX 路径长度保护的 Core endpoint helper，并让 Core 与 Desktop Main 使用同一派生逻辑。
- [x] 2.2 扩展 Session launch、metadata、summary、持久化与 Core router，使实际终端类型在创建、重建和 `session.changed` 中保持一致。
- [x] 2.3 将 `session.changed` 从 Core Bridge、Electron Main、Preload 一直转发到 `DesktopApi.sessions.onChanged()`。
- [x] 2.4 运行本组单元与协议测试，确认新的端点和 Session 数据契约转绿。

## 3. 可扩展 Session 工作区

- [x] 3.1 以稳定桌面高度实现横向可滚动的 Session 标签栏、类型徽标、关闭动作和固定新建入口，且仅挂载活动 xterm。
- [x] 3.2 实现全部会话弹层的搜索、内部滚动、类型/状态展示和关闭操作，并使活动标签自动进入可视区域。
- [x] 3.3 将 `App` 接入 Session 变化订阅、创建/关闭错误状态与运行时 Session upsert，避免 fixture 或标题推断。
- [x] 3.4 扩展 runtime mock 以提供稳定的多会话和事件场景，运行浏览器 E2E 证明标签、类型和大数量导航转绿。

## 4. 接口完整性与真实运行时

- [x] 4.1 补齐 `createDesktopApi`、Desktop Core Bridge 和 Electron Main 的全公开方法/事件契约覆盖，确保每个声明接口可达且未声明通道被拒绝。
- [x] 4.2 修复并运行实际 Electron/Core Session 生命周期测试，确认 macOS 不再因 Unix socket 路径失败而回退到静态 UI。
- [x] 4.3 在真实 Electron 中检查 Core 连接失败时的可识别 Renderer 错误状态，不允许 mock 覆盖。

## 5. 最终验收

- [x] 5.1 在 Chrome 的 1440×900 与 980×640 桌面视口验收标签轨道、全部会话弹层、类型显示、xterm 和现有 Agent/资源工作流。
- [x] 5.2 运行相关 Vitest、Playwright 浏览器与 Electron 测试、桌面 typecheck 和 production build。
- [x] 5.3 使用 `nvm use 24.12.0` 打包 macOS `dir`，验证最终 `.app` 能启动真实 Core 并完成最小会话生命周期。
