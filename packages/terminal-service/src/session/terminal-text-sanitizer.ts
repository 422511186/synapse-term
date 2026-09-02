export interface TerminalTextEdits {
  text: string;
  backspaces: number;
}

const MAX_TERMINAL_CONTROL_CARRY_BYTES = 16 * 1024;
const MAX_TERMINAL_TEXT_STREAM_TAIL_BYTES = 16 * 1024;

/**
 * Converts PTY control output into readable text while preserving stream order.
 *
 * Carriage returns are treated as line redraws. This removes zsh/readline redraw
 * padding from external output without changing the bytes written to the PTY or
 * the terminal UI consumer's raw display path.
 */
export class TerminalTextSanitizer {
  #escapeCarry = '';
  #unicodeCarry = '';
  #streamTail = '';
  #pendingCarriageReturn = false;

  push(data: string): string {
    return this.pushWithEdits(data).text;
  }

  pushWithEdits(data: string): TerminalTextEdits {
    const input = this.#escapeCarry + this.#unicodeCarry + data;
    this.#escapeCarry = '';
    this.#unicodeCarry = '';
    let output = '';
    let backspaces = 0;
    let index = 0;

    if (this.#pendingCarriageReturn && input.length > 0) {
      this.#pendingCarriageReturn = false;
      if (input.startsWith('\n')) {
        output = '\r\n';
        index = 1;
      } else if (input.startsWith('\r\n')) {
        output = '\r\n';
        index = 2;
      } else {
        const reset = this.#resetCurrentLine(output);
        output = reset.output;
        backspaces += reset.backspaces;
      }
    }

    while (index < input.length) {
      const character = input[index]!;
      const code = input.charCodeAt(index);

      if (character === '\x1b' || isC1SequenceIntroducer(code)) {
        const end = escapeSequenceEnd(input, index);
        if (end === undefined) {
          this.#escapeCarry = limitControlCarry(input.slice(index));
          break;
        }
        index = end;
        continue;
      }

      if (code === 8) {
        const previous = lastCharacter(output);
        if (previous !== undefined && previous !== '\r' && previous !== '\n') {
          output = output.slice(0, -previous.length);
        } else {
          const streamPrevious = lastCharacter(this.#streamTail);
          if (streamPrevious !== undefined && streamPrevious !== '\r' && streamPrevious !== '\n') {
            this.#streamTail = this.#streamTail.slice(0, -streamPrevious.length);
            backspaces += 1;
          }
        }
        index += 1;
        continue;
      }

      if (code === 13) {
        if (input[index + 1] === '\n') {
          output += '\r\n';
          index += 2;
          continue;
        }
        if (input[index + 1] === '\r' && input[index + 2] === '\n') {
          output += '\r\n';
          index += 3;
          continue;
        }
        if (index + 1 >= input.length) {
          this.#pendingCarriageReturn = true;
          break;
        }
        const reset = this.#resetCurrentLine(output);
        output = reset.output;
        backspaces += reset.backspaces;
        index += 1;
        continue;
      }

      if (isHighSurrogate(code)) {
        const nextCode = input.charCodeAt(index + 1);
        if (isLowSurrogate(nextCode)) {
          output += input.slice(index, index + 2);
          index += 2;
          continue;
        }
        if (index + 1 === input.length) {
          this.#unicodeCarry = character;
          break;
        }
        index += 1;
        continue;
      }
      if (isLowSurrogate(code)) {
        index += 1;
        continue;
      }
      if (code === 9 || code === 10 || (code >= 0x20 && !isC1Control(code))) {
        output += character;
      }
      index += 1;
    }

    this.#streamTail = takeFromEnd(
      `${this.#streamTail}${output}`,
      MAX_TERMINAL_TEXT_STREAM_TAIL_BYTES,
    );
    return { text: output, backspaces };
  }

  flush(): string {
    this.#escapeCarry = '';
    this.#unicodeCarry = '';
    this.#streamTail = '';
    this.#pendingCarriageReturn = false;
    return '';
  }

  #resetCurrentLine(output: string): { output: string; backspaces: number } {
    const streamLength = this.#streamTail.length;
    const combined = `${this.#streamTail}${output}`;
    const lineStart = combined.lastIndexOf('\n') + 1;
    if (lineStart < streamLength) {
      const removed = this.#streamTail.slice(lineStart);
      this.#streamTail = this.#streamTail.slice(0, lineStart);
      return { output: '', backspaces: [...removed].length };
    }
    return { output: output.slice(0, lineStart - streamLength), backspaces: 0 };
  }
}

function escapeSequenceEnd(value: string, start: number): number | undefined {
  const first = value[start];
  const second = value[start + 1];
  if (first === '\x9b' || (first === '\x1b' && second === '[')) {
    const from = first === '\x9b' ? start + 1 : start + 2;
    for (let index = from; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) return index + 1;
    }
    return undefined;
  }
  if (
    (first === '\x1b' && (second === ']' || second === 'P' || second === '^' || second === '_')) ||
    first === '\x90' ||
    first === '\x98' ||
    first === '\x9d' ||
    first === '\x9e' ||
    first === '\x9f'
  ) {
    const from = first === '\x1b' ? start + 2 : start + 1;
    for (let index = from; index < value.length; index += 1) {
      if (value[index] === '\x07') return index + 1;
      if (value[index] === '\x1b' && value[index + 1] === '\\') return index + 2;
      if (value[index] === '\x9c') return index + 1;
    }
    return undefined;
  }
  return Math.min(start + 2, value.length);
}

function limitControlCarry(value: string): string {
  if (Buffer.byteLength(value, 'utf8') <= MAX_TERMINAL_CONTROL_CARRY_BYTES) return value;

  const prefixLength = controlSequencePrefixLength(value);
  const prefix = value.slice(0, prefixLength);
  const prefixBytes = Buffer.byteLength(prefix, 'utf8');
  return `${prefix}${takeFromEnd(value, MAX_TERMINAL_CONTROL_CARRY_BYTES - prefixBytes)}`;
}

function controlSequencePrefixLength(value: string): number {
  if (value.startsWith('\x1b') && ['[', ']', 'P', '^', '_'].includes(value[1] ?? '')) return 2;
  if (value.startsWith('\x1b')) return 1;
  if (isC1SequenceIntroducer(value.charCodeAt(0))) return 1;
  return Math.min(1, value.length);
}

function isC1Control(code: number): boolean {
  return code >= 0x80 && code <= 0x9f;
}

function isC1SequenceIntroducer(code: number): boolean {
  return (
    code === 0x90 ||
    code === 0x98 ||
    code === 0x9b ||
    code === 0x9d ||
    code === 0x9e ||
    code === 0x9f
  );
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function lastCharacter(value: string): string | undefined {
  return [...value].at(-1);
}

function takeFromEnd(value: string, maxBytes: number): string {
  let bytes = 0;
  let output = '';
  for (const character of [...value].reverse()) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maxBytes) break;
    output = character + output;
    bytes += size;
  }
  return output;
}
