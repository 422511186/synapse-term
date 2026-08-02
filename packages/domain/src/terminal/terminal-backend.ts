/**
 * Terminal Backend 契约（领域层）
 *
 * 架构文档 4.6：Terminal 是可替换后端（LocalPtyBackend / RemoteTerminalBackend /
 * MockTerminalBackend 等）。后端必须显式声明能力，上层按能力决定是否允许操作，
 * 而不是执行失败后再猜测原因；不支持的能力必须显式报告，不能模拟成功。
 */
import type { ExecutionDialect } from '../session/session-state.js';

/** Terminal 能力声明项（架构文档 2.5） */
export type TerminalCapability =
  | 'observeScreen'
  | 'replayOutput'
  | 'structuredExecute'
  | 'interrupt'
  | 'resize'
  | 'persistentShellState'
  | 'supportedDialects';

/** Terminal 后端能力集合：能力项 + 支持的执行方言 */
export interface TerminalBackendCapabilities {
  readonly capabilities: readonly TerminalCapability[];
  readonly dialects: readonly ExecutionDialect[];
}

/** Terminal 后端元信息（供 Registry 注册与契约测试使用） */
export interface TerminalBackendInfo {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: TerminalBackendCapabilities;
}

/** 判断后端是否声明了某项能力 */
export function hasTerminalCapability(
  info: TerminalBackendInfo,
  capability: TerminalCapability,
): boolean {
  return info.capabilities.capabilities.includes(capability);
}

/** 判断后端是否支持某个执行方言 */
export function supportsExecutionDialect(
  info: TerminalBackendInfo,
  dialect: ExecutionDialect,
): boolean {
  return info.capabilities.dialects.includes(dialect);
}
