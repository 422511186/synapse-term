import { TerminalTextSanitizer } from './terminal-text-sanitizer.js';

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
  readonly #sanitizer = new TerminalTextSanitizer();

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
    this.#consume(data);
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

  #consume(value: string): void {
    const clean = this.#sanitizer.pushWithEdits(value);
    for (let index = 0; index < clean.backspaces; index += 1) {
      this.#erasePreviousCharacter();
    }
    this.#appendVisible(clean.text);
  }

  #appendVisible(visible: string): void {
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

  #erasePreviousCharacter(): void {
    if (!this.#truncated) {
      const character = lastCharacter(this.#rendered);
      if (character === undefined || character === '\r' || character === '\n') return;
      this.#rendered = this.#rendered.slice(0, -character.length);
      this.#totalBytes -= Buffer.byteLength(character, 'utf8');
      return;
    }

    const character = lastCharacter(this.#tail);
    if (character === undefined || character === '\r' || character === '\n') return;
    this.#tail = this.#tail.slice(0, -character.length);
    this.#totalBytes -= Buffer.byteLength(character, 'utf8');
  }
}

function lastCharacter(value: string): string | undefined {
  return [...value].at(-1);
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
