export interface CommandOutputCollectorOptions {
  maxBytes?: number;
}

export interface CommandOutputSnapshot {
  cursor: number;
  text: string;
  head: string;
  tail: string;
  totalBytes: number;
  truncated: boolean;
}

const ESC = '\u001b';

export class CommandOutputCollector {
  readonly #maxBytes: number;
  readonly #headBytes: number;
  readonly #tailBytes: number;
  #cursor = 0;
  #totalBytes = 0;
  #rendered = '';
  #head = '';
  #tail = '';
  #truncated = false;
  #controlCarry = '';
  #markerCarry = '';
  #currentLine = '';
  #afterCarriageReturn = false;
  #lastLine: string | undefined;

  constructor(options: CommandOutputCollectorOptions = {}) {
    this.#maxBytes = options.maxBytes ?? 64 * 1024;
    if (!Number.isSafeInteger(this.#maxBytes) || this.#maxBytes < 1) {
      throw new RangeError('maxBytes must be a positive safe integer');
    }
    this.#headBytes = Math.ceil(this.#maxBytes / 2);
    this.#tailBytes = Math.floor(this.#maxBytes / 2);
  }

  append(cursor: number, data: string): void {
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      throw new RangeError('cursor must be a non-negative safe integer');
    }
    this.#cursor = Math.max(this.#cursor, cursor);
    if (data.length === 0) return;
    const visible = this.#stripControls(data);
    this.#consumeVisible(visible);
  }

  snapshot(): CommandOutputSnapshot {
    const pending = this.#currentLine;
    if (!this.#truncated) {
      const text = this.#rendered + pending;
      if (Buffer.byteLength(text, 'utf8') > this.#maxBytes) {
        const head = takeFromStart(text, this.#headBytes);
        const tail = takeFromEnd(text, this.#tailBytes);
        return {
          cursor: this.#cursor,
          text: `${head}\n...[truncated]...\n${tail}`,
          head,
          tail,
          totalBytes: this.#totalBytes + Buffer.byteLength(pending, 'utf8'),
          truncated: true,
        };
      }
      return {
        cursor: this.#cursor,
        text,
        head: text,
        tail: text,
        totalBytes: this.#totalBytes + Buffer.byteLength(pending, 'utf8'),
        truncated: false,
      };
    }

    const tail = pending.length > 0 ? this.#appendTail(this.#tail, pending) : this.#tail;
    return {
      cursor: this.#cursor,
      text: `${this.#head}\n...[truncated]...\n${tail}`,
      head: this.#head,
      tail,
      totalBytes: this.#totalBytes + Buffer.byteLength(pending, 'utf8'),
      truncated: true,
    };
  }

  #consumeVisible(value: string): void {
    for (const character of value) {
      if (character === '\r') {
        this.#afterCarriageReturn = true;
        continue;
      }
      if (character === '\n') {
        this.#finishLine();
        this.#afterCarriageReturn = false;
        continue;
      }
      if (this.#afterCarriageReturn) {
        this.#currentLine = '';
        this.#afterCarriageReturn = false;
      }
      if (character === '\t' || character >= ' ') this.#currentLine += character;
    }
  }

  #finishLine(): void {
    const line = this.#currentLine;
    this.#currentLine = '';
    if (line.length > 0 && line === this.#lastLine) return;
    this.#lastLine = line;
    this.#record(`${line}\n`);
  }

  #record(fragment: string): void {
    const bytes = Buffer.byteLength(fragment, 'utf8');
    this.#totalBytes += bytes;
    if (!this.#truncated) {
      this.#rendered += fragment;
      if (Buffer.byteLength(this.#rendered, 'utf8') > this.#maxBytes) {
        this.#truncated = true;
        this.#head = takeFromStart(this.#rendered, this.#headBytes);
        this.#tail = takeFromEnd(this.#rendered, this.#tailBytes);
        this.#rendered = '';
      }
      return;
    }
    this.#tail = this.#appendTail(this.#tail, fragment);
  }

  #appendTail(existing: string, addition: string): string {
    return takeFromEnd(existing + addition, this.#tailBytes);
  }

  #stripControls(value: string): string {
    const markerResult = stripPrintableMarkers(this.#markerCarry + value);
    this.#markerCarry = markerResult.carry;
    value = markerResult.visible;
    const input = this.#controlCarry + value;
    this.#controlCarry = '';
    let visible = '';
    let index = 0;

    while (index < input.length) {
      if (input[index] !== ESC) {
        const code = input.charCodeAt(index);
        if (code === 0x09 || code === 0x0a || code === 0x0d || code >= 0x20) {
          visible += input[index];
        }
        index += 1;
        continue;
      }

      if (index + 1 >= input.length) {
        this.#controlCarry = input.slice(index);
        break;
      }
      const kind = input[index + 1];
      if (kind === '[') {
        const end = findCsiEnd(input, index + 2);
        if (end < 0) {
          this.#controlCarry = input.slice(index);
          break;
        }
        index = end + 1;
        continue;
      }
      if (kind === ']' || kind === 'P' || kind === '^' || kind === '_') {
        const end = findStringTerminator(input, index + 2);
        if (end < 0) {
          this.#controlCarry = input.slice(index);
          break;
        }
        index = end;
        if (input[end] === ESC) index += 2;
        else index += 1;
        continue;
      }
      index += Math.min(2, input.length - index);
    }

    return visible;
  }
}

function stripPrintableMarkers(value: string): { visible: string; carry: string } {
  const prefix = '__TA_DONE_';
  let visible = '';
  let index = 0;
  while (index < value.length) {
    const start = value.indexOf(prefix, index);
    if (start < 0) {
      const suffixStart = possiblePrefixStart(value, prefix, index);
      visible += value.slice(index, suffixStart);
      return { visible, carry: suffixStart < value.length ? value.slice(suffixStart) : '' };
    }
    visible += value.slice(index, start);
    const end = value.indexOf('__', start + prefix.length);
    if (end < 0) return { visible, carry: value.slice(start) };
    const marker = value.slice(start, end + 2);
    if (/^__TA_DONE_[^;\r\n]+;-?\d+__$/.test(marker)) {
      index = end + 2;
      continue;
    }
    visible += marker;
    index = end + 2;
  }
  return { visible, carry: '' };
}

function possiblePrefixStart(value: string, prefix: string, from: number): number {
  const end = value.length;
  for (let length = Math.min(prefix.length - 1, end - from); length > 0; length -= 1) {
    const start = end - length;
    if (start >= from && value.slice(start) === prefix.slice(0, length)) return start;
  }
  return end;
}

function findCsiEnd(value: string, start: number): number {
  for (let index = start; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) return index;
  }
  return -1;
}

function findStringTerminator(value: string, start: number): number {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === '\u0007') return index;
    if (value[index] === ESC && value[index + 1] === '\\') return index;
  }
  return -1;
}

function takeFromStart(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = '';
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function takeFromEnd(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = '';
  for (const character of [...value].reverse()) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maxBytes) break;
    result = character + result;
    bytes += characterBytes;
  }
  return result;
}
