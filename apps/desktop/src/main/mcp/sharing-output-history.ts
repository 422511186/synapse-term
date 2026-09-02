import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type { OutputCursor } from '@synapse-term/domain';
import { TerminalTextSanitizer } from '@synapse-term/terminal-service';

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
    const clean = this.#sanitizer.pushWithEdits(data);
    for (let index = 0; index < clean.backspaces; index += 1) {
      if (!this.#redactor.backspace()) this.#removePreviousVisibleCharacters(1);
    }
    if (clean.text.length === 0) return;
    const redacted = this.#redactor.push(clean.text);
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

  #removePreviousVisibleCharacters(count: number): void {
    for (let index = 0; index < count; index += 1) {
      const previous = lastCharacter(this.#text);
      if (previous === undefined || previous === '\r' || previous === '\n') return;
      this.#text = this.#text.slice(0, -previous.length);
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

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be positive`);
  return value;
}

function requireNonEmpty(value: string, name: string): string {
  if (value.length === 0) throw new RangeError(`${name} must not be empty`);
  return value;
}

function lastCharacter(value: string): string | undefined {
  return [...value].at(-1);
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
