/**
 * 允许副作用导入 CSS（如 @xterm/xterm/css/xterm.css）；
 * 打包器（Vite）负责实际处理，类型检查仅需模块存在。
 */
declare module '*.css';
