import { describe, expect, it } from 'vitest';

import {
  MAX_SHARING_OUTPUT_HISTORY_BYTES,
  MAX_SHARING_OUTPUT_PAGE_BYTES,
  SharingOutputHistory,
} from './sharing-output-history.js';

describe('SharingOutputHistory', () => {
  it('reads a bounded history repeatedly without consuming it', () => {
    const history = new SharingOutputHistory({
      sessionId: 'session-1',
      maxBytes: 32,
      maxPageBytes: 5,
    });
    history.append('abcdef');
    history.append('ghijkl');

    const first = history.read();
    expect(first).toMatchObject({
      output: 'abcde',
      hasMore: true,
      historyTruncated: false,
    });
    expect(first.nextCursor).toBeTypeOf('string');
    expect(first.earliestCursor).toBeTypeOf('string');
    expect(history.read({ afterCursor: first.nextCursor })).toMatchObject({
      output: 'fghij',
      hasMore: true,
    });
    expect(history.read()).toEqual(first);
  });

  it('reports a truncated cursor and provides the earliest retained position', () => {
    const history = new SharingOutputHistory({
      sessionId: 'session-1',
      maxBytes: 6,
      maxPageBytes: 16,
    });
    const boundary = history.read().nextCursor;
    history.append('0123456789');

    const page = history.read({ afterCursor: boundary });
    expect(page).toMatchObject({
      sessionId: 'session-1',
      output: '456789',
      redacted: false,
      hasMore: false,
      historyTruncated: true,
    });
    expect(page.nextCursor).toBeTypeOf('string');
    expect(page.earliestCursor).toBeTypeOf('string');
  });

  it('supports a tail read and rejects a mixed cursor request', () => {
    const history = new SharingOutputHistory({ sessionId: 'session-1', maxPageBytes: 6 });
    history.append('一二三四五');
    const cursor = history.read().nextCursor;

    expect(history.read({ tail: true })).toMatchObject({ output: '四五', hasMore: false });
    expect(() => history.read({ tail: true, afterCursor: cursor })).toThrow(RangeError);
  });

  it('cleans terminal controls and retains the Session scope', () => {
    const history = new SharingOutputHistory({ sessionId: 'session-1' });
    history.append('before\x1b[31mred\x1b[0mafter\x1b]777;TA;secret;0\x07');

    expect(history.read().output).toBe('beforeredafter');
    expect(history.read().sessionId).toBe('session-1');
  });

  it('uses a Sharing-scoped cursor and rejects a cursor from another history', () => {
    const first = new SharingOutputHistory({ sessionId: 'session-1', sharingId: 'sharing-1' });
    first.append('old output');
    const cursor = first.read().nextCursor;

    const second = new SharingOutputHistory({ sessionId: 'session-1', sharingId: 'sharing-2' });
    second.append('new output');

    expect(cursor).not.toBe(second.read().nextCursor);
    expect(() => second.read({ afterCursor: cursor })).toThrowError(
      expect.objectContaining({ code: 'OUTPUT_CURSOR_STALE' }),
    );
  });

  it('rejects a cursor issued for another Session even when the position matches', () => {
    const first = new SharingOutputHistory({ sessionId: 'session-1', sharingId: 'sharing-1' });
    first.append('same');
    const cursor = first.read().nextCursor;
    const other = new SharingOutputHistory({ sessionId: 'session-2', sharingId: 'sharing-2' });

    expect(() => other.read({ afterCursor: cursor })).toThrowError(
      expect.objectContaining({ code: 'OUTPUT_CURSOR_STALE' }),
    );
  });

  it('redacts continuous text before applying an external page boundary', () => {
    const history = new SharingOutputHistory({ sessionId: 'session-1', maxPageBytes: 4 });
    history.append('prefix api_key=super-');
    expect(history.read().output).toBe('pref');
    history.append('secret-value\nnext\n');

    const pages: string[] = [];
    let afterCursor: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const page = history.read({ ...(afterCursor === undefined ? {} : { afterCursor }) });
      pages.push(page.output);
      afterCursor = page.nextCursor;
      hasMore = page.hasMore;
    }

    const output = pages.join('');
    expect(output).toContain('[REDACTED]');
    expect(output).toContain('next');
    expect(output).not.toContain('super-secret-value');
  });

  it('sanitizes split ANSI and OSC sequences before retention', () => {
    const history = new SharingOutputHistory({ sessionId: 'session-1' });
    history.append('safe\x1b[3');
    history.append('1mred\x1b[0m\x1b]777;TA;hidden;');
    history.append('0\x07visible\x00\x07\r\n');

    expect(history.read().output).toBe('saferedvisible\r\n');
  });

  it('removes split DCS controls and C1 control characters before retention', () => {
    const history = new SharingOutputHistory({ sessionId: 'session-1' });
    history.append('before\x1b_777;hidden');
    history.append('\x1b\\after\u0085visible\u009b31mtext');

    expect(history.read().output).toBe('beforeaftervisibletext');
  });

  it('keeps retention and page sizes bounded even when callers request larger values', () => {
    const history = new SharingOutputHistory({
      sessionId: 'session-1',
      maxBytes: Number.MAX_SAFE_INTEGER,
      maxPageBytes: Number.MAX_SAFE_INTEGER,
    });
    history.append('x'.repeat(MAX_SHARING_OUTPUT_HISTORY_BYTES + 1));

    const page = history.read({ tail: true, maxBytes: Number.MAX_SAFE_INTEGER });
    expect(Buffer.byteLength(page.output, 'utf8')).toBeLessThanOrEqual(
      MAX_SHARING_OUTPUT_PAGE_BYTES,
    );
    expect(Buffer.byteLength(history.read({ tail: true }).output, 'utf8')).toBe(
      MAX_SHARING_OUTPUT_PAGE_BYTES,
    );
    expect(Buffer.byteLength(page.earliestCursor, 'utf8')).toBeGreaterThan(0);
  });

  it('keeps a split surrogate pair intact across PTY chunks', () => {
    const history = new SharingOutputHistory({ sessionId: 'session-1' });
    history.append('前😀'.slice(0, 2));
    history.append('前😀'.slice(2));

    expect(history.read().output).toBe('前😀');
  });

  it('does not expose payload from an oversized unfinished control sequence', () => {
    const history = new SharingOutputHistory({ sessionId: 'session-1' });

    history.append(`before\x1b]999;${'secret-control-payload'.repeat(2_000)}`);
    history.append('\x07after');

    expect(history.read().output).toBe('beforeafter');
  });
});
