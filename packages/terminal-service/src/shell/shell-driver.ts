import {
  parseCompletionPayload,
  shellSingleQuote,
  type CompletionFrame,
  type ExecutionDialect,
} from '@synapse-term/domain';

export interface ShellDriver {
  readonly dialect: ExecutionDialect;
  buildProbe(nonce: string): string;
  wrapCommand(command: string, nonce: string): string;
  parseCompletion(payload: string): CompletionFrame | null;
}

export const SHELL_OUTPUT_START_PAYLOAD = 'TA_START';

export class ShellDriverError extends Error {
  readonly code: 'execution_dialect_observe_only' | 'command_not_auditable';

  constructor(code: 'execution_dialect_observe_only' | 'command_not_auditable', message: string) {
    super(message);
    this.name = 'ShellDriverError';
    this.code = code;
  }
}

function validateCommandSafety(command: string): void {
  if (containsDisallowedControlCharacter(command)) {
    throw new ShellDriverError(
      'command_not_auditable',
      'Command contains disallowed control characters',
    );
  }
  if (command.includes('\u001b]777')) {
    throw new ShellDriverError(
      'command_not_auditable',
      'Command contains OSC 777 control sequence that could forge completion events',
    );
  }
  if (/__TA_DONE_|__TA_START__/.test(command)) {
    throw new ShellDriverError(
      'command_not_auditable',
      'Command contains transaction boundary markers',
    );
  }
}

function containsDisallowedControlCharacter(command: string): boolean {
  for (const character of command) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && codePoint <= 0x08) return true;
  }
  return false;
}

export class PosixShellDriver implements ShellDriver {
  readonly dialect = 'posix' as const;

  buildProbe(nonce: string): string {
    const marker = shellSingleQuote(`__TA_OS_${nonce}__`);
    return this.wrapCommand(
      `printf '%s:%s\\n' ${marker} "$(uname -s 2>/dev/null || printf unknown)"`,
      nonce,
    );
  }

  wrapCommand(command: string, nonce: string): string {
    validateCommandSafety(command);
    const safeCommand = protectNestedPowerShellCommand(command);
    const quotedNonce = shellSingleQuote(nonce);
    if (canInlineTransaction(safeCommand)) {
      return [
        `printf '%s%s' '__TA_' 'START__'`,
        `{ ${terminateInlineCommand(safeCommand)} }`,
        '__ta_exit=$?',
        `printf '\\033]777;TA;%s;%s\\007' ${quotedNonce} "$__ta_exit"`,
        `printf '__TA_DONE_%s;%s__\\n' ${quotedNonce} "$__ta_exit"`,
        'unset __ta_exit',
      ].join('; ');
    }
    return [
      `printf '%s%s' '__TA_' 'START__'`,
      '{',
      safeCommand,
      '}',
      '__ta_exit=$?',
      `printf '\\033]777;TA;%s;%s\\007' ${quotedNonce} "$__ta_exit"`,
      `printf '__TA_DONE_%s;%s__\\n' ${quotedNonce} "$__ta_exit"`,
      'unset __ta_exit',
    ].join('\r');
  }

  parseCompletion(payload: string): CompletionFrame | null {
    return parseCompletionPayload(payload);
  }
}

export class PowerShellDriver implements ShellDriver {
  readonly dialect = 'powershell' as const;

  buildProbe(nonce: string): string {
    const marker = powerShellSingleQuote(`__TA_OS_${nonce}__`);
    return this.wrapCommand(
      [
        "$__ta_os = if ($IsWindows -or $env:OS -eq 'Windows_NT') { 'Windows' } elseif ($IsLinux) { 'Linux' } elseif ($IsMacOS) { 'Darwin' } else { [System.Runtime.InteropServices.RuntimeInformation]::OSDescription }",
        `[Console]::WriteLine(${marker} + ':' + $__ta_os)`,
      ].join('; '),
      nonce,
    );
  }

  wrapCommand(command: string, nonce: string): string {
    validateCommandSafety(command);
    const quotedNonce = powerShellSingleQuote(nonce);
    if (canInlineTransaction(command)) {
      return [
        `[Console]::Write('__TA_'+'START__')`,
        '$global:LASTEXITCODE=0',
        `try { . { ${terminateInlineCommand(command)} } | Out-String -Stream | ForEach-Object { [Console]::WriteLine($_) }; if (-not $?) { if ([int]$global:LASTEXITCODE -eq 0) { $global:LASTEXITCODE=1 } } } catch { Write-Error $_; $global:LASTEXITCODE=1 }`,
        '$__ta_exit=[int]$global:LASTEXITCODE',
        `[Console]::Write(([char]27+']777;TA;'+${quotedNonce}+';'+$__ta_exit+[char]7))`,
        `[Console]::WriteLine('__TA_DONE_'+${quotedNonce}+';'+$__ta_exit+'__')`,
        'Remove-Variable __ta_exit -ErrorAction SilentlyContinue',
      ].join('; ');
    }
    return [
      `[Console]::Write('__TA_'+'START__')`,
      '$global:LASTEXITCODE=0',
      'try {',
      '  . {',
      command,
      '  } | Out-String -Stream | ForEach-Object { [Console]::WriteLine($_) }',
      '  if (-not $?) {',
      '    if ([int]$global:LASTEXITCODE -eq 0) { $global:LASTEXITCODE=1 }',
      '  }',
      '} catch {',
      '  Write-Error $_',
      '  $global:LASTEXITCODE=1',
      '}',
      '$__ta_exit=[int]$global:LASTEXITCODE',
      `[Console]::Write(([char]27+']777;TA;'+${quotedNonce}+';'+$__ta_exit+[char]7))`,
      `[Console]::WriteLine('__TA_DONE_'+${quotedNonce}+';'+$__ta_exit+'__')`,
      'Remove-Variable __ta_exit -ErrorAction SilentlyContinue',
    ].join('\r');
  }

  parseCompletion(payload: string): CompletionFrame | null {
    return parseCompletionPayload(payload);
  }
}

export class ObserveOnlyShellDriver implements ShellDriver {
  readonly dialect = 'observe_only' as const;

  buildProbe(): string {
    return this.#reject();
  }

  wrapCommand(): string {
    return this.#reject();
  }

  parseCompletion(): CompletionFrame | null {
    return null;
  }

  #reject(): never {
    throw new ShellDriverError(
      'execution_dialect_observe_only',
      'The current Session execution dialect is observe-only',
    );
  }
}

const drivers: Readonly<Record<ExecutionDialect, ShellDriver>> = {
  posix: new PosixShellDriver(),
  powershell: new PowerShellDriver(),
  observe_only: new ObserveOnlyShellDriver(),
};

export function resolveShellDriver(dialect: ExecutionDialect): ShellDriver {
  return drivers[dialect];
}

/**
 * Split plaintext source into physical PTY lines. Each returned line is
 * submitted with a carriage return; empty interior lines are significant.
 */
export function shellInputLines(payload: string): string[] {
  if (payload.length === 0) return [];
  const lines = payload.split(/\r\n|[\r\n]/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function canInlineTransaction(command: string): boolean {
  const trimmed = command.trimEnd();
  if (trimmed.length === 0 || /[\r\n#]/.test(command)) return false;
  if (/\\[;&|]$/.test(trimmed)) return false;
  return !/(?:&&|\|\||[&|])$/.test(trimmed);
}

function protectNestedPowerShellCommand(command: string): string {
  const invocation = /^(\s*)([^\s"';&|]*?(?:powershell|pwsh)(?:\.exe)?)(?=\s|$)([\s\S]*)$/i.exec(
    command,
  );
  if (invocation === null) return command;

  const executable = invocation[2]!
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/\.exe$/i, '')
    .toLowerCase();
  if (executable !== 'powershell' && executable !== 'pwsh') return command;

  const argumentsText = invocation[3] ?? '';
  const commandArgument = /(\s-(?:command|c)(?:\s+|=|:))"((?:\\.|[^"\\])*)"([\s\S]*)$/i.exec(
    argumentsText,
  );
  if (commandArgument === null) return command;

  const script = decodePosixDoubleQuoted(commandArgument[2]!);
  if (script === undefined) return command;
  const replacement = `${commandArgument[1]}${shellSingleQuote(script)}${commandArgument[3] ?? ''}`;
  const replacementStart = commandArgument.index;
  return `${invocation[1]}${invocation[2]}${argumentsText.slice(0, replacementStart)}${replacement}`;
}

function decodePosixDoubleQuoted(value: string): string | undefined {
  let decoded = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character !== '\\') {
      decoded += character;
      continue;
    }
    const next = value[index + 1];
    if (next === undefined) return undefined;
    if (next === '\n') {
      index += 1;
      continue;
    }
    if (next === '$' || next === String.fromCharCode(96) || next === '"' || next === '\\') {
      decoded += next;
      index += 1;
      continue;
    }
    decoded += '\\' + next;
    index += 1;
  }
  return decoded;
}

function terminateInlineCommand(command: string): string {
  return command.trimEnd().endsWith(';') ? command : `${command};`;
}

function powerShellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
