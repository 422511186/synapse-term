/**
 * 字面 Shell 命令完成帧协议（参考 develop 的控制帧分离，specs/mcp-access）
 *
 * 用户命令原文先进入目标 Shell，随后由独立完成探针通过 OSC 777 序列回传
 * `TA;<nonce>;<exitCode>` 完成帧；执行器据此判定收敛，不依赖屏幕启发式。
 */

export interface CompletionFrame {
  nonce: string;
  exitCode: number;
}

export const LITERAL_SHELL_TRANSPORT = 'literal_shell' as const;

export type CommandTransportMode = typeof LITERAL_SHELL_TRANSPORT;

export type CommandAuditErrorCode = 'COMMAND_NOT_AUDITABLE' | 'UNSUPPORTED_SHELL';

export function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function parseCompletionPayload(payload: string): CompletionFrame | null {
  if (!payload.startsWith('TA;')) {
    return null;
  }

  const body = payload.slice('TA;'.length);
  const separator = body.lastIndexOf(';');
  if (separator <= 0) {
    return null;
  }

  const nonce = body.slice(0, separator);
  const exitCodeText = body.slice(separator + 1);
  if (!/^-?\d+$/.test(exitCodeText)) {
    return null;
  }

  const exitCode = Number(exitCodeText);
  return Number.isSafeInteger(exitCode) ? { nonce, exitCode } : null;
}

export function parseCompletionFrame(output: string): CompletionFrame | null {
  const prefix = '\x1b]777;TA;';
  const start = output.indexOf(prefix);
  if (start < 0) return null;

  const frameStart = start + prefix.length;
  const frameEnd = output.indexOf('\x07', frameStart);
  if (frameEnd < 0) return null;
  return parseCompletionPayload(`TA;${output.slice(frameStart, frameEnd)}`);
}
