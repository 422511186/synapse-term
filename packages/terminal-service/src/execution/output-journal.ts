import { appendFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export interface JournalEvent {
  sessionId: string;
  sequence: number;
  data: Uint8Array;
}

export interface JournalCursor {
  sessionId: string;
  sequence: number;
}

export interface JournalReadResult {
  events: JournalEvent[];
  historyGap: boolean;
  oldestSequence: number | undefined;
  nextSequence: number;
  hasMore: boolean;
  nextAfterSequence: number;
}

export interface OutputJournalOptions {
  directory?: string;
  maxSessionBytes?: number;
  maxGlobalBytes?: number;
}

interface SessionBuffer {
  nextSequence: number;
  bytes: number;
  events: JournalEvent[];
  pending: JournalEvent[];
}

export class OutputJournal {
  readonly #directory: string | undefined;
  readonly #maxSessionBytes: number;
  readonly #maxGlobalBytes: number;
  readonly #sessions = new Map<string, SessionBuffer>();
  readonly #globalOrder: JournalEvent[] = [];
  #globalBytes = 0;

  constructor(options: OutputJournalOptions = {}) {
    this.#directory = options.directory;
    this.#maxSessionBytes = options.maxSessionBytes ?? 64 * 1024 * 1024;
    this.#maxGlobalBytes = options.maxGlobalBytes ?? 1024 * 1024 * 1024;
    if (
      !Number.isSafeInteger(this.#maxSessionBytes) ||
      this.#maxSessionBytes < 1 ||
      !Number.isSafeInteger(this.#maxGlobalBytes) ||
      this.#maxGlobalBytes < this.#maxSessionBytes
    ) {
      throw new RangeError('journal capacities must be positive and globally bounded');
    }
  }

  createCursor(sessionId: string, afterSequence = 0): JournalCursor {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new RangeError('cursor sequence must be a non-negative safe integer');
    }
    return { sessionId, sequence: afterSequence };
  }

  append(sessionId: string, data: Uint8Array): JournalEvent {
    if (sessionId.length === 0) throw new RangeError('sessionId must not be empty');
    const buffer = this.#getSession(sessionId);
    const event: JournalEvent = {
      sessionId,
      sequence: buffer.nextSequence,
      data: new Uint8Array(data),
    };
    buffer.nextSequence += 1;
    buffer.events.push(event);
    buffer.pending.push(event);
    const bytes = event.data.byteLength;
    buffer.bytes += bytes;
    this.#globalBytes += bytes;
    this.#globalOrder.push(event);
    this.#trimSession(buffer);
    this.#trimGlobal();
    return this.#cloneEvent(event);
  }

  read(cursor: JournalCursor, limit: number): JournalReadResult {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('read limit must be positive');
    const result = this.replay(cursor.sessionId, cursor.sequence, limit);
    const last = result.events.at(-1);
    if (last !== undefined) cursor.sequence = last.sequence;
    return result;
  }

  replay(
    sessionId: string,
    afterSequence: number,
    limit = Number.MAX_SAFE_INTEGER,
    maxBytes = Number.MAX_SAFE_INTEGER,
  ): JournalReadResult {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError('replay limit must be a positive safe integer');
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new RangeError('replay maxBytes must be a positive safe integer');
    }
    const buffer = this.#getSession(sessionId);
    const available = buffer.events.filter((event) => event.sequence > afterSequence);
    const events: JournalEvent[] = [];
    let selectedBytes = 0;
    for (const event of available) {
      if (events.length >= limit) break;
      if (events.length > 0 && selectedBytes + event.data.byteLength > maxBytes) break;
      events.push(this.#cloneEvent(event));
      selectedBytes += event.data.byteLength;
    }
    const oldestSequence = buffer.events[0]?.sequence;
    const nextAfterSequence = events.at(-1)?.sequence ?? afterSequence;
    return {
      events,
      historyGap:
        oldestSequence !== undefined
          ? afterSequence < oldestSequence - 1
          : buffer.nextSequence > afterSequence + 1,
      oldestSequence,
      nextSequence: buffer.nextSequence,
      hasMore: available.some((event) => event.sequence > nextAfterSequence),
      nextAfterSequence,
    };
  }

  async flush(): Promise<void> {
    if (this.#directory === undefined) return;
    await mkdir(this.#directory, { recursive: true });
    for (const [sessionId, buffer] of this.#sessions) {
      if (buffer.pending.length === 0) continue;
      const lines =
        buffer.pending
          .map((event) =>
            JSON.stringify({
              sequence: event.sequence,
              data: Buffer.from(event.data).toString('base64'),
            }),
          )
          .join('\n') + '\n';
      await appendFile(join(this.#directory, `${this.#fileName(sessionId)}.log`), lines, 'utf8');
      buffer.pending.length = 0;
    }
  }

  get totalBytes(): number {
    return this.#globalBytes;
  }

  #getSession(sessionId: string): SessionBuffer {
    let buffer = this.#sessions.get(sessionId);
    if (buffer === undefined) {
      buffer = { nextSequence: 1, bytes: 0, events: [], pending: [] };
      this.#sessions.set(sessionId, buffer);
    }
    return buffer;
  }

  #trimSession(buffer: SessionBuffer): void {
    while (buffer.bytes > this.#maxSessionBytes && buffer.events.length > 0) {
      const removed = buffer.events.shift()!;
      buffer.bytes -= removed.data.byteLength;
      this.#globalBytes -= removed.data.byteLength;
      const pendingIndex = buffer.pending.indexOf(removed);
      if (pendingIndex >= 0) buffer.pending.splice(pendingIndex, 1);
      const index = this.#globalOrder.indexOf(removed);
      if (index >= 0) this.#globalOrder.splice(index, 1);
    }
  }

  #trimGlobal(): void {
    while (this.#globalBytes > this.#maxGlobalBytes && this.#globalOrder.length > 0) {
      const removed = this.#globalOrder.shift()!;
      const buffer = this.#sessions.get(removed.sessionId);
      if (buffer === undefined) continue;
      const index = buffer.events.indexOf(removed);
      if (index < 0) continue;
      buffer.events.splice(index, 1);
      buffer.bytes -= removed.data.byteLength;
      this.#globalBytes -= removed.data.byteLength;
      const pendingIndex = buffer.pending.indexOf(removed);
      if (pendingIndex >= 0) buffer.pending.splice(pendingIndex, 1);
    }
  }

  #cloneEvent(event: JournalEvent): JournalEvent {
    return { ...event, data: new Uint8Array(event.data) };
  }

  #fileName(sessionId: string): string {
    const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
    if (safe === sessionId && safe.length > 0) return safe;
    return `${safe || 'session'}-${createHash('sha256').update(sessionId, 'utf8').digest('hex')}`;
  }
}
