export const TERMINAL_OUTPUT_FRAME_BYTES = 32 * 1024;

function escapeSequenceComplete(sequence: string): boolean {
  if (sequence.length === 0 || sequence[0] !== '\x1b') return true;
  if (sequence.length === 1) return false;
  const second = sequence[1]!;
  if (second === ']') {
    return sequence.endsWith('\x07') || sequence.endsWith('\x1b\\');
  }
  if (second === '[' || (second >= '0' && second <= '?')) {
    for (let index = 2; index < sequence.length; index += 1) {
      const code = sequence.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) return true;
    }
    return false;
  }
  return true;
}

export interface SplitTerminalOutputResult {
  chunks: string[];
  carry: string;
}

export function splitTerminalOutput(
  data: string,
  maxBytes: number,
  carry = '',
): SplitTerminalOutputResult {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError('maxBytes must be a positive integer');
  }
  const combined = carry + data;
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  let pendingEscape = '';

  for (const character of combined) {
    const size = Buffer.byteLength(character, 'utf8');
    if (pendingEscape.length > 0) {
      pendingEscape += character;
      if (pendingEscape.length >= 4_096 || escapeSequenceComplete(pendingEscape)) {
        current += pendingEscape;
        currentBytes += Buffer.byteLength(pendingEscape, 'utf8');
        pendingEscape = '';
      }
      continue;
    }
    if (character === '\x1b') {
      if (current.length > 0) {
        chunks.push(current);
        current = '';
        currentBytes = 0;
      }
      pendingEscape = character;
      continue;
    }
    if (currentBytes + size > maxBytes && current.length > 0) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += character;
    currentBytes += size;
  }

  if (pendingEscape.length > 0) return { chunks, carry: pendingEscape };
  if (current.length > 0) chunks.push(current);
  return { chunks, carry: '' };
}
