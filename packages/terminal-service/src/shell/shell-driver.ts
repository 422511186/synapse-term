import {
  LITERAL_SHELL_TRANSPORT,
  parseCompletionPayload,
  shellSingleQuote,
  type CompletionFrame,
  type CommandAuditErrorCode,
} from '@synapse-term/domain';

export interface ShellDispatch {
  readonly command: string;
  readonly probe: string;
  readonly payload: string;
  readonly transportMode: typeof LITERAL_SHELL_TRANSPORT;
  readonly echoPattern: {
    readonly start: string;
    readonly end: string;
  };
}

export interface ShellDriver {
  readonly dialect: 'posix' | 'powershell';
  buildEnvironmentProbe(nonce: string): string;
  buildDispatch(command: string, nonce: string): ShellDispatch;
  parseCompletion(payload: string): CompletionFrame | null;
}

export class ShellDriverError extends Error {
  readonly code: CommandAuditErrorCode;

  constructor(code: CommandAuditErrorCode, message: string) {
    super(message);
    this.name = 'ShellDriverError';
    this.code = code;
  }
}

abstract class BaseShellDriver implements ShellDriver {
  abstract readonly dialect: 'posix' | 'powershell';

  buildEnvironmentProbe(nonce: string): string {
    validateNonce(nonce);
    return `echo __SYNAPSE_DIALECT_${nonce}__:$?\r`;
  }

  buildDispatch(command: string, nonce: string): ShellDispatch {
    validateLiteralCommand(command);
    validateNonce(nonce);
    const probe = this.buildCompletionProbe(nonce);
    const commandTerminator = command.endsWith('\r') || command.endsWith('\n') ? '' : '\r';
    return {
      command,
      probe,
      payload: `${command}${commandTerminator}${probe}\r`,
      transportMode: LITERAL_SHELL_TRANSPORT,
      echoPattern: this.buildEchoPattern(nonce),
    };
  }

  abstract parseCompletion(payload: string): CompletionFrame | null;

  protected abstract buildCompletionProbe(nonce: string): string;

  protected abstract buildEchoPattern(nonce: string): ShellDispatch['echoPattern'];
}

export class PosixShellDriver extends BaseShellDriver {
  readonly dialect = 'posix' as const;

  protected buildCompletionProbe(nonce: string): string {
    return `printf '\\033]777;TA;%s;%s\\007' ${shellSingleQuote(nonce)} "$?"`;
  }

  protected buildEchoPattern(nonce: string): ShellDispatch['echoPattern'] {
    return {
      start: `printf '\\033]777;TA;%s;%s\\007' ${shellSingleQuote(nonce)} `,
      end: '"$?"',
    };
  }

  parseCompletion(payload: string): CompletionFrame | null {
    return parseCompletionPayload(payload);
  }
}

export class PowerShellDriver extends BaseShellDriver {
  readonly dialect = 'powershell' as const;

  protected buildCompletionProbe(nonce: string): string {
    const quotedNonce = powerShellSingleQuote(nonce);
    return `[Console]::Write(([char]27+']777;TA;'+${quotedNonce}+';'+$(if($?){0}elseif($LASTEXITCODE){$LASTEXITCODE}else{1})+[char]7))`;
  }

  protected buildEchoPattern(nonce: string): ShellDispatch['echoPattern'] {
    const quotedNonce = powerShellSingleQuote(nonce);
    return {
      start: `[Console]::Write(([char]27+']777;TA;'+${quotedNonce}+';'+`,
      end: '+[char]7))',
    };
  }

  parseCompletion(payload: string): CompletionFrame | null {
    return parseCompletionPayload(payload);
  }
}

export function resolveShellDriver(terminalType: string): ShellDriver {
  if (/powershell|pwsh/i.test(terminalType)) return new PowerShellDriver();
  if (/bash|zsh|wsl|posix/i.test(terminalType)) return new PosixShellDriver();
  throw new ShellDriverError(
    'UNSUPPORTED_SHELL',
    `当前 Session 的 Shell 类型「${terminalType}」不支持字面命令执行。`,
  );
}

export function parseEnvironmentFingerprint(
  output: string,
  nonce: string,
): { dialect: 'posix' | 'powershell'; platform: 'unix' | 'windows' } | null {
  validateNonce(nonce);
  const marker = `__SYNAPSE_DIALECT_${nonce}__`;
  const escapeCharacter = String.fromCharCode(0x1b);
  const ansiSequence = new RegExp(`${escapeCharacter}\\[[0-?]*[ -/]*[@-~]`, 'g');
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.replace(ansiSequence, '').trim();
    const markerIndex = line.indexOf(marker);
    if (markerIndex < 0) continue;
    const value = line
      .slice(markerIndex + marker.length)
      .replace(/^:/, '')
      .trim();
    if (/^\d+$/.test(value)) return { dialect: 'posix', platform: 'unix' };
    if (/^(?:true|false)$/i.test(value)) {
      return { dialect: 'powershell', platform: 'windows' };
    }
  }
  return null;
}

function validateLiteralCommand(command: string): void {
  if (command.trim().length === 0) {
    throw new ShellDriverError('COMMAND_NOT_AUDITABLE', '命令为空，无法进行字面审计。');
  }
  for (const character of command) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      codePoint < 0x20 &&
      codePoint !== 0x09 &&
      codePoint !== 0x0a &&
      codePoint !== 0x0d
    ) {
      throw new ShellDriverError('COMMAND_NOT_AUDITABLE', '命令包含不能安全审计的低位控制字符。');
    }
  }
  if (command.includes('\u001b]777')) {
    throw new ShellDriverError(
      'COMMAND_NOT_AUDITABLE',
      '命令包含可能伪造事务完成帧的 OSC 777 控制序列。',
    );
  }
  if (/__TA_(?:START__|DONE_)/.test(command)) {
    throw new ShellDriverError('COMMAND_NOT_AUDITABLE', '命令包含保留的事务边界标记。');
  }
}

function validateNonce(nonce: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(nonce)) {
    throw new ShellDriverError('COMMAND_NOT_AUDITABLE', '事务 nonce 含有不支持的字符。');
  }
}

function powerShellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
