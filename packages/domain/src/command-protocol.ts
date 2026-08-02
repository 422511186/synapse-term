export interface CompletionFrame {
  nonce: string;
  exitCode: number;
}

export function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildPosixCommand(command: string, nonce: string, lineSeparator = '\r'): string {
  const quotedNonce = shellSingleQuote(nonce);
  return [
    "printf '%s%s' '__TA_' 'START__'",
    '{',
    command,
    '}',
    '__ta_exit=$?',
    `printf '\u001b]777;TA;%s;%s\u0007' ${quotedNonce} "$__ta_exit"`,
    `printf '__TA_DONE_%s;%s__\n' ${quotedNonce} "$__ta_exit"`,
    'unset __ta_exit',
    '',
  ].join(lineSeparator);
}

export function parseCompletionFrame(output: string): CompletionFrame | null {
  const prefix = '\u001b]777;TA;';
  const start = output.indexOf(prefix);
  if (start < 0) {
    return null;
  }

  const frameStart = start + prefix.length;
  const frameEnd = output.indexOf('\u0007', frameStart);
  if (frameEnd < 0) {
    return null;
  }

  return parseCompletionPayload(`TA;${output.slice(frameStart, frameEnd)}`);
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

export function parseCompletionMarker(output: string): CompletionFrame | null {
  const prefix = '__TA_DONE_';
  const start = output.indexOf(prefix);
  if (start < 0) return null;
  const markerEnd = output.indexOf('__', start + prefix.length);
  if (markerEnd < 0) return null;
  const payload = output.slice(start + prefix.length, markerEnd);
  const separator = payload.lastIndexOf(';');
  if (separator <= 0) return null;
  const nonce = payload.slice(0, separator);
  const exitCodeText = payload.slice(separator + 1);
  if (!/^-?\d+$/.test(exitCodeText)) return null;
  const exitCode = Number(exitCodeText);
  return Number.isSafeInteger(exitCode) ? { nonce, exitCode } : null;
}
