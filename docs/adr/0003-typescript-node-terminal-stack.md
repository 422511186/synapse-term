# TypeScript 与 Node.js 终端技术栈

桌面客户端使用 Electron、React、TypeScript 和 `@xterm/xterm`；独立的 Node.js/TypeScript Core 使用 `node-pty`、`@xterm/headless` 和 `@xterm/addon-serialize` 持有终端会话。该技术栈契合团队的 TypeScript 专长，并将渲染与无头终端语义保持在同一个生态内，同时明确接受 Electron 资源占用和原生模块打包成本。Go、Rust 和 .NET 曾被否决作为主要实现，因为它们的终端优势不足以引入一门更陌生的核心语言。
