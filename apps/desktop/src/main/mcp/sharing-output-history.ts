import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type { OutputCursor } from '@synapse-term/domain';

import { SecretRedactor, type RedactionStream } from './secret-redactor.js';

export interface SharingOutputHistoryOptions {
  sessionId: string;
  sharingId?: string | undefined;
  maxBytes?: number | undefined;
  maxPageBytes?: number | undefined;
  redactor?: SecretRedactor | undefined;
}

export interface OutputHistoryReadInput {
  afterCursor?: OutputCursor | undefined;
  tail?: boolean | undefined;
  maxBytes?: number | undefined;
}

export interface OutputHistoryPage {
  sessionId: string;
  output: string;
  redacted: boolean;
  nextCursor: OutputCursor;
  hasMore: boolean;
  historyTruncated: boolean;
  earliestCursor: OutputCursor;
}

export class OutputCursorError extends Error {
  readonly code = 'OUTPUT_CURSOR_STALE' as const;

  constructor(message = '输出游标不属于当前 Sharing。') {
    super(message);
    this.name = this.code;
  }
}

export const MAX_SHARING_OUTPUT_HISTORY_BYTES = 256 * 1024;
export const MAX_SHARING_OUTPUT_PAGE_BYTES = 64 * 1024;
const DEFAULT_MAX_BYTES = MAX_SHARING_OUTPUT_HISTORY_BYTES;
const DEFAULT_MAX_PAGE_BYTES = MAX_SHARING_OUTPUT_PAGE_BYTES;
const MAX_TERMINAL_CONTROL_CARRY_BYTES = 16 * 1024;

/**
 * 当前 Sharing 的短期 PTY 输出历史。
 *
 * 调用方应只追加 SessionActor 的协议隔离输出；这里仍会做第二层终端控制字符清理和
 * 连续脱敏，确保分页读取永远不会看到原始 PTY 字节或半截凭据。
 */
export class SharingOutputHistory {
  readonly #sessionId: string;
  readonly #sharingId: string;
  readonly #cursorSecret = randomBytes(32);
  readonly #maxBytes: number;
  #maxPageBytes: number;
  readonly #redactor: RedactionStream;
  readonly #sanitizer = new TerminalTextSanitizer();
  #text = '';
  #cursor = 0;
  #redacted = false;
  #disposed = false;

  constructor(options: SharingOutputHistoryOptions) {
    this.#sessionId = requireNonEmpty(options.sessionId, 'sessionId');
    this.#sharingId = options.sharingId ?? randomUUID();
    this.#maxBytes = Math.min(
      positiveSafeInteger(options.maxBytes ?? DEFAULT_MAX_BYTES, 'maxBytes'),
      MAX_SHARING_OUTPUT_HISTORY_BYTES,
    );
    this.#maxPageBytes = Math.min(
      positiveSafeInteger(options.maxPageBytes ?? DEFAULT_MAX_PAGE_BYTES, 'maxPageBytes'),
      MAX_SHARING_OUTPUT_PAGE_BYTES,
    );
    if (this.#maxPageBytes > this.#maxBytes) this.#maxPageBytes = this.#maxBytes;
    this.#redactor = (options.redactor ?? new SecretRedactor()).createStream();
  }

  get sessionId(): string {
    return this.#sessionId;
  }

  get sharingId(): string {
    return this.#sharingId;
  }

  get cursor(): OutputCursor {
    return this.#encodeCursor(this.#cursor);
  }

  get earliestCursor(): OutputCursor {
    return this.#encodeCursor(this.#earliestPosition);
  }

  get #earliestPosition(): number {
    return this.#cursor - Buffer.byteLength(this.#text, 'utf8');
  }

  append(data: string): void {
    if (this.#disposed || data.length === 0) return;
    const clean = this.#sanitizer.push(data);
    if (clean.length === 0) return;
    const redacted = this.#redactor.push(clean);
    this.#redacted ||= redacted.redacted;
    this.#appendRedacted(redacted.text);
  }

  flush(): void {
    if (this.#disposed) return;
    const clean = this.#sanitizer.flush();
    if (clean.length > 0) {
      const redacted = this.#redactor.push(clean);
      this.#redacted ||= redacted.redacted;
      this.#appendRedacted(redacted.text);
    }
    const redacted = this.#redactor.flush();
    this.#redacted ||= redacted.redacted;
    this.#appendRedacted(redacted.text);
  }

  read(input: OutputHistoryReadInput = {}): OutputHistoryPage {
    if (this.#disposed) {
      return this.#page('', this.#cursor, false, false);
    }
    if (input.tail === true && input.afterCursor !== undefined) {
      throw new RangeError('tail and afterCursor are mutually exclusive');
    }
    const maxBytes = Math.min(
      positiveSafeInteger(input.maxBytes ?? this.#maxPageBytes, 'maxBytes'),
      this.#maxPageBytes,
    );
    const earliestPosition = this.#earliestPosition;
    const requestedPosition =
      input.afterCursor === undefined ? earliestPosition : this.#decodeCursor(input.afterCursor);
    const historyTruncated =
      input.afterCursor !== undefined && requestedPosition < earliestPosition;

    if (input.tail === true) {
      const output = takeFromEnd(this.#text, maxBytes);
      return this.#page(output, this.#cursor, false, false);
    }

    const startCursor = Math.max(earliestPosition, Math.min(requestedPosition, this.#cursor));
    const offset = startCursor - earliestPosition;
    const available = sliceByBytes(this.#text, offset);
    const output = takeFromStart(available, maxBytes);
    const nextCursor = startCursor + Buffer.byteLength(output, 'utf8');
    return this.#page(output, nextCursor, nextCursor < this.#cursor, historyTruncated);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.flush();
    this.#disposed = true;
    this.#text = '';
  }

  #appendRedacted(data: string): void {
    if (data.length === 0) return;
    this.#cursor += Buffer.byteLength(data, 'utf8');
    this.#text += data;
    if (Buffer.byteLength(this.#text, 'utf8') > this.#maxBytes) {
      this.#text = takeFromEnd(this.#text, this.#maxBytes);
    }
  }

  #page(
    output: string,
    nextPosition: number,
    hasMore: boolean,
    historyTruncated: boolean,
  ): OutputHistoryPage {
    return {
      sessionId: this.#sessionId,
      output,
      redacted: this.#redacted,
      nextCursor: this.#encodeCursor(nextPosition),
      hasMore,
      historyTruncated,
      earliestCursor: this.earliestCursor,
    };
  }

  #encodeCursor(position: number): OutputCursor {
    const payload = Buffer.from(
      JSON.stringify({
        version: 1,
        sessionId: this.#sessionId,
        sharingId: this.#sharingId,
        position,
      }),
      'utf8',
    ).toString('base64url');
    const signature = createHmac('sha256', this.#cursorSecret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  #decodeCursor(cursor: OutputCursor): number {
    if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 2_048) {
      throw new OutputCursorError('输出游标格式无效，请从当前 synapse_observe 响应重新获取游标。');
    }
    const separator = cursor.indexOf('.');
    if (
      separator <= 0 ||
      separator === cursor.length - 1 ||
      cursor.indexOf('.', separator + 1) >= 0
    ) {
      throw new OutputCursorError('输出游标格式无效，请从当前 synapse_observe 响应重新获取游标。');
    }
    const payload = cursor.slice(0, separator);
    const signature = cursor.slice(separator + 1);
    const expectedSignature = createHmac('sha256', this.#cursorSecret)
      .update(payload)
      .digest('base64url');
    const givenBytes = Buffer.from(signature, 'base64url');
    const expectedBytes = Buffer.from(expectedSignature, 'base64url');
    if (givenBytes.length !== expectedBytes.length || !timingSafeEqual(givenBytes, expectedBytes)) {
      throw new OutputCursorError();
    }

    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    } catch {
      throw new OutputCursorError();
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      !('version' in value) ||
      !('sessionId' in value) ||
      !('sharingId' in value) ||
      !('position' in value) ||
      value.version !== 1 ||
      value.sessionId !== this.#sessionId ||
      value.sharingId !== this.#sharingId ||
      typeof value.position !== 'number' ||
      !Number.isSafeInteger(value.position) ||
      value.position < 0 ||
      value.position > this.#cursor
    ) {
      throw new OutputCursorError();
    }
    return value.position;
  }
}

export class TerminalTextSanitizer {
  #escapeCarry = '';
  #unicodeCarry = '';

  push(data: string): string {
    const input = this.#escapeCarry + this.#unicodeCarry + data;
    this.#escapeCarry = '';
    this.#unicodeCarry = '';
    let output = '';
    let index = 0;
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
      if (code === 9 || code === 10 || code === 13 || (code >= 0x20 && !isC1Control(code))) {
        output += character;
      }
      index += 1;
    }
    return output;
  }

  flush(): string {
    this.#escapeCarry = '';
    this.#unicodeCarry = '';
    return '';
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

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be positive`);
  return value;
}

function requireNonEmpty(value: string, name: string): string {
  if (value.length === 0) throw new RangeError(`${name} must not be empty`);
  return value;
}

function takeFromStart(value: string, maxBytes: number): string {
  let bytes = 0;
  let output = '';
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maxBytes) break;
    output += character;
    bytes += size;
  }
  return output;
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

function sliceByBytes(value: string, byteOffset: number): string {
  if (byteOffset <= 0) return value;
  let bytes = 0;
  let index = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > byteOffset) break;
    bytes += size;
    index += character.length;
  }
  return value.slice(index);
}
