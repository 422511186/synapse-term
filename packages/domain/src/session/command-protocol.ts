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

export type ExecutionContextId = string;
export type TransactionId = string;
/** 服务端签名、绑定当前 Session/Sharing 的不透明输出游标。 */
export type OutputCursor = string;
export type ExternalTransactionKind = 'structured' | 'interactive';
export type ExternalTransactionStatus = 'running' | 'completed' | 'interrupted' | 'unknown';

/** 交互输入允许的固定键名；不开放原始 PTY 字节或任意转义序列。 */
export type InputKey =
  | 'up'
  | 'down'
  | 'right'
  | 'left'
  | 'enter'
  | 'esc'
  | 'tab'
  | 'backspace'
  | 'delete'
  | 'home'
  | 'end'
  | 'pageup'
  | 'pagedown'
  | 'space'
  | 'f1'
  | 'f2'
  | 'f3'
  | 'f4'
  | 'f5'
  | 'f6'
  | 'f7'
  | 'f8'
  | 'f9'
  | 'f10'
  | 'f11'
  | 'f12';

/** 交互事务启动时明确选择的有限输入授权档位。 */
export type InputGrantMode = 'one_shot' | 'bounded';
export type InputGrantId = string;
export type InputRequestId = string;

export interface TransactionOutputRange {
  startCursor: OutputCursor;
  endCursor: OutputCursor;
}

export interface CompletionMetadata {
  confirmed: boolean;
  exitCode?: number | undefined;
}

export const LITERAL_SHELL_TRANSPORT = 'literal_shell' as const;

export type CommandTransportMode = typeof LITERAL_SHELL_TRANSPORT;

export type CommandAuditErrorCode =
  'COMMAND_NOT_AUDITABLE' | 'INTERACTIVE_COMMAND_UNSUPPORTED' | 'UNSUPPORTED_SHELL';

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
  const prefixes = ['\x1b]777;TA;', '\x9d777;TA;'];
  let start = -1;
  let prefix = '';
  for (const candidate of prefixes) {
    const candidateStart = output.indexOf(candidate);
    if (candidateStart >= 0 && (start < 0 || candidateStart < start)) {
      start = candidateStart;
      prefix = candidate;
    }
  }
  if (start < 0) return null;

  const frameStart = start + prefix.length;
  const terminators = [
    { index: output.indexOf('\x07', frameStart), length: 1 },
    { index: output.indexOf('\x9c', frameStart), length: 1 },
    { index: output.indexOf('\x1b\\', frameStart), length: 2 },
  ].filter((candidate) => candidate.index >= 0);
  if (terminators.length === 0) return null;
  const terminator = terminators.reduce((left, right) => (right.index < left.index ? right : left));
  return parseCompletionPayload(`TA;${output.slice(frameStart, terminator.index)}`);
}
