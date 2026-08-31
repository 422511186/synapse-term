export interface OutputBufferOptions {
  maxBytes?: number;
}

export interface OutputSnapshot {
  cursor: number;
  text: string;
  head: string;
  tail: string;
  totalBytes: number;
  truncated: boolean;
}

const HEAD_MARKER = '\n...[truncated]...\n';

export class OutputBuffer {
  readonly #maxBytes: number;
  #cursor = 0;
  #totalBytes = 0;
  #rendered = '';
  #head = '';
  #tail = '';
  #truncated = false;
  #escapeCarry = '';

  constructor(options: OutputBufferOptions = {}) {
    this.#maxBytes = options.maxBytes ?? 64 * 1024;
    if (!Number.isSafeInteger(this.#maxBytes) || this.#maxBytes < 1) {
      throw new RangeError('maxBytes must be a positive safe integer');
    }
  }

  append(cursor: number, data: string): void {
    if (!Number.isSafeInteger(cursor) || cursor < this.#cursor) {
      throw new RangeError('cursor must be a non-decreasing safe integer');
    }
    this.#cursor = cursor;
    const visible = this.#stripEscapeSequences(data);
    if (visible.length === 0) return;

    this.#totalBytes += Buffer.byteLength(visible, 'utf8');
    if (!this.#truncated) {
      this.#rendered += visible;
      if (Buffer.byteLength(this.#rendered, 'utf8') <= this.#maxBytes) return;
      const half = Math.floor(this.#maxBytes / 2);
      this.#head = takeFromStart(this.#rendered, half);
      this.#tail = takeFromEnd(this.#rendered, half);
      this.#rendered = '';
      this.#truncated = true;
      return;
    }
    this.#tail = takeFromEnd(this.#tail + visible, Math.floor(this.#maxBytes / 2));
  }

  snapshot(): OutputSnapshot {
    if (!this.#truncated) {
      return {
        cursor: this.#cursor,
        text: this.#rendered,
        head: this.#rendered,
        tail: this.#rendered,
        totalBytes: this.#totalBytes,
        truncated: false,
      };
    }
    return {
      cursor: this.#cursor,
      text: `${this.#head}${HEAD_MARKER}${this.#tail}`,
      head: this.#head,
      tail: this.#tail,
      totalBytes: this.#totalBytes,
      truncated: true,
    };
  }

  #stripEscapeSequences(value: string): string {
    const input = this.#escapeCarry + value;
    let visible = '';
    let index = 0;
    while (index < input.length) {
      if (input[index] !== '\x1b') {
        const code = input.charCodeAt(index);
        if (code === 9 || code === 10 || code === 13 || code >= 32) visible += input[index];
        index += 1;
        continue;
      }
      const end = escapeSequenceEnd(input, index);
      if (end < 0) break;
      index = end;
    }
    this.#escapeCarry = index < input.length && input[index] === '\x1b' ? input.slice(index) : '';
    return visible;
  }
}

function escapeSequenceEnd(value: string, start: number): number {
  const kind = value[start + 1];
  if (kind === '[') {
    for (let index = start + 2; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) return index + 1;
    }
    return -1;
  }
  if (kind === ']' || kind === 'P' || kind === '^' || kind === '_') {
    for (let index = start + 2; index < value.length; index += 1) {
      if (value[index] === '\x07') return index + 1;
      if (value[index] === '\x1b' && value[index + 1] === '\\') return index + 2;
    }
    return -1;
  }
  return start + Math.min(2, value.length - start);
}

function takeFromStart(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = '';
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

function takeFromEnd(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = '';
  const characters = [...value];
  for (const character of characters.reverse()) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maxBytes) break;
    result = character + result;
    bytes += size;
  }
  return result;
}
