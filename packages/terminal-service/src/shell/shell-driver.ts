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

/** 只包含用户命令的字面 Shell payload；交互事务不会在这里附加完成 Probe。 */
export interface ShellCommandDispatch {
  readonly command: string;
  readonly payload: string;
  readonly transportMode: typeof LITERAL_SHELL_TRANSPORT;
}

export interface ShellDriver {
  readonly dialect: 'posix' | 'powershell';
  buildEnvironmentProbe(nonce: string): string;
  validateCommand(command: string): void;
  validateInteractiveCommand(command: string): void;
  buildCommandOnlyDispatch(command: string): ShellCommandDispatch;
  buildInteractiveDispatch(command: string): ShellCommandDispatch;
  buildCompletionProbe(nonce: string): string;
  buildCompletionEchoPattern(nonce: string): ShellDispatch['echoPattern'];
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

  validateCommand(command: string): void {
    validateLiteralCommand(command, true);
  }

  validateInteractiveCommand(command: string): void {
    validateLiteralCommand(command, false);
  }

  buildCommandOnlyDispatch(command: string): ShellCommandDispatch {
    this.validateInteractiveCommand(command);
    const commandTerminator = command.endsWith('\r') || command.endsWith('\n') ? '' : '\r';
    return {
      command,
      payload: `${command}${commandTerminator}`,
      transportMode: LITERAL_SHELL_TRANSPORT,
    };
  }

  buildInteractiveDispatch(command: string): ShellCommandDispatch {
    return this.buildCommandOnlyDispatch(command);
  }

  buildCompletionProbe(nonce: string): string {
    validateNonce(nonce);
    return this.createCompletionProbe(nonce);
  }

  buildCompletionEchoPattern(nonce: string): ShellDispatch['echoPattern'] {
    validateNonce(nonce);
    return this.createEchoPattern(nonce);
  }

  buildDispatch(command: string, nonce: string): ShellDispatch {
    this.validateCommand(command);
    const commandOnly = this.buildCommandOnlyDispatch(command);
    const probe = this.buildCompletionProbe(nonce);
    return {
      command,
      probe,
      payload: `${commandOnly.payload}${probe}\r`,
      transportMode: commandOnly.transportMode,
      echoPattern: this.buildCompletionEchoPattern(nonce),
    };
  }

  abstract parseCompletion(payload: string): CompletionFrame | null;

  protected abstract createCompletionProbe(nonce: string): string;

  protected abstract createEchoPattern(nonce: string): ShellDispatch['echoPattern'];
}

export class PosixShellDriver extends BaseShellDriver {
  readonly dialect = 'posix' as const;

  protected createCompletionProbe(nonce: string): string {
    return `printf '\\033]777;TA;%s;%s\\007' ${shellSingleQuote(nonce)} "$?"`;
  }

  protected createEchoPattern(nonce: string): ShellDispatch['echoPattern'] {
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

  protected createCompletionProbe(nonce: string): string {
    const quotedNonce = powerShellSingleQuote(nonce);
    return `[Console]::Write(([char]27+']777;TA;'+${quotedNonce}+';'+$(if($?){0}elseif($null -ne $LASTEXITCODE){$LASTEXITCODE}else{1})+[char]7))`;
  }

  protected createEchoPattern(nonce: string): ShellDispatch['echoPattern'] {
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

function validateLiteralCommand(command: string, rejectInteractive: boolean): void {
  if (command.trim().length === 0) {
    throw new ShellDriverError('COMMAND_NOT_AUDITABLE', '命令为空，无法进行字面审计。');
  }
  for (const character of command) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) &&
      codePoint !== 0x09 &&
      codePoint !== 0x0a &&
      codePoint !== 0x0d
    ) {
      throw new ShellDriverError('COMMAND_NOT_AUDITABLE', '命令包含不能安全审计的低位控制字符。');
    }
  }
  if (
    command.includes('\u001b]777') ||
    command.includes('\u009d777') ||
    /777\s*;\s*TA\s*;/i.test(command)
  ) {
    throw new ShellDriverError(
      'COMMAND_NOT_AUDITABLE',
      '命令包含可能伪造事务完成帧的 OSC 777 控制序列。',
    );
  }
  if (/__TA_(?:START__|DONE_)/.test(command)) {
    throw new ShellDriverError('COMMAND_NOT_AUDITABLE', '命令包含保留的事务边界标记。');
  }
  if (
    /__(?:SYNAPSE|TA)_(?:TRANSACTION|TX|COMPLETION)_[A-Z0-9_-]+__/i.test(command) ||
    /__TA_(?:START|DONE)(?:__|[_-])/i.test(command)
  ) {
    throw new ShellDriverError('COMMAND_NOT_AUDITABLE', '命令包含保留的事务边界标记。');
  }
  if (rejectInteractive && isKnownInteractiveCommand(command)) {
    throw new ShellDriverError(
      'INTERACTIVE_COMMAND_UNSUPPORTED',
      '命令需要持续交互或不会返回当前 Shell 提示符，不能作为结构化外部事务提交。',
    );
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

export function isKnownInteractiveCommand(command: string): boolean {
  const tokens = tokenizeCommand(command);
  const executable = tokens[0]?.toLowerCase().replaceAll('\\', '/').split('/').pop();
  if (executable === undefined) return false;
  if (
    [
      'ssh',
      'telnet',
      'top',
      'htop',
      'vim',
      'vi',
      'nvim',
      'nano',
      'less',
      'more',
      'watch',
      'sudo',
      'doas',
      'su',
      'passwd',
      'login',
      'read',
      'select',
      'fzf',
      'dialog',
      'whiptail',
      'mysql',
      'psql',
      'sqlite3',
    ].includes(executable)
  ) {
    return true;
  }
  if (['tmux', 'screen'].includes(executable)) return true;
  if (['bash', 'zsh', 'sh', 'fish', 'pwsh', 'powershell'].includes(executable)) {
    return (
      tokens.length === 1 || tokens.some((token) => token === '-i' || token === '--interactive')
    );
  }
  if (['python', 'python3', 'node', 'nodejs', 'irb', 'lua'].includes(executable)) {
    return (
      tokens.length === 1 || tokens.some((token) => token === '-i' || token === '--interactive')
    );
  }
  if (
    (executable === 'docker' || executable === 'podman') &&
    tokens.some((token) => token.toLowerCase() === 'exec')
  ) {
    const execIndex = tokens.findIndex((token) => token.toLowerCase() === 'exec');
    const execArguments = execIndex < 0 ? [] : tokens.slice(execIndex + 1);
    const hasInteractive = execArguments.some((token) => /^(?:-[^-]*i|--interactive)/i.test(token));
    const hasTty = execArguments.some((token) => /^(?:-[^-]*t|--tty)/i.test(token));
    return hasInteractive && hasTty;
  }
  return false;
}

/** Alias used by callers that care about stdin consumption rather than UI shape. */
export function isKnownStdinReader(command: string): boolean {
  return isKnownInteractiveCommand(command);
}

function tokenizeCommand(command: string): string[] {
  return command.match(/'(?:[^']|'')*'|"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
}
