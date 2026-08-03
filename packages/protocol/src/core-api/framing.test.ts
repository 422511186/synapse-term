import { describe, expect, it } from 'vitest';

import {
  FrameDecoder,
  FramingError,
  encodeControlFrame,
  encodeTerminalOutputFrame,
  splitUtf8Text,
} from './framing.js';

describe('IPC framing', () => {
  it('incrementally decodes a control frame split at every byte boundary', () => {
    const envelope = {
      kind: 'request' as const,
      id: 'request-1',
      protocolVersion: { major: 1, minor: 0 },
      sentAt: '2026-07-27T15:00:00.000Z',
      method: 'session.create',
      payload: { profileId: 'shell-1' },
    };
    const encoded = encodeControlFrame(envelope);
    const decoder = new FrameDecoder();
    const decoded = [];

    for (const byte of encoded) {
      decoded.push(...decoder.push(Uint8Array.of(byte)));
    }

    expect(decoded).toEqual([{ kind: 'control', envelope }]);
    expect(decoder.bufferedBytes).toBe(0);
  });

  it('preserves arbitrary bytes in a terminal output frame', () => {
    const encoded = encodeTerminalOutputFrame({
      sessionId: 'session-1',
      sequence: 9,
      data: Uint8Array.from([0, 27, 91, 255, 10]),
    });

    const frames = new FrameDecoder().push(encoded);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      kind: 'terminal_output',
      sessionId: 'session-1',
      sequence: 9,
    });
    if (frames[0]?.kind !== 'terminal_output') throw new Error('expected terminal output');
    expect(Array.from(frames[0].data)).toEqual([0, 27, 91, 255, 10]);
  });

  it('rejects an advertised frame larger than the configured hard limit', () => {
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(1025, 0);
    const decoder = new FrameDecoder({
      maxFrameBytes: 1024,
      maxBufferedBytes: 2048,
      pauseAtBufferedBytes: 512,
    });

    try {
      decoder.push(prefix);
      throw new Error('expected a framing error');
    } catch (error) {
      expect(error).toBeInstanceOf(FramingError);
      expect(error).toMatchObject({ code: 'frame_too_large' });
    }
  });

  it('rejects an oversized terminal output frame before writing it', () => {
    expect(() =>
      encodeTerminalOutputFrame({
        sessionId: 'session-1',
        sequence: 1,
        data: Buffer.alloc(8 * 1024 * 1024),
      }),
    ).toThrow(FramingError);
  });

  it('rejects an oversized control frame before writing it', () => {
    expect(() =>
      encodeControlFrame({
        kind: 'request',
        id: 'request-large',
        protocolVersion: { major: 1, minor: 0 },
        sentAt: '2026-07-27T15:00:00.000Z',
        method: 'core.status',
        payload: { output: 'x'.repeat(8 * 1024 * 1024) },
      }),
    ).toThrow(FramingError);
  });

  it('splits UTF-8 text without changing its encoded bytes', () => {
    const value = 'abc你好吗'.repeat(8);
    const chunks = splitUtf8Text(value, 8);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => Buffer.byteLength(chunk, 'utf8') <= 8)).toBe(true);
    expect(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk, 'utf8')))).toEqual(
      Buffer.from(value, 'utf8'),
    );
  });

  it('signals transport backpressure while an incomplete frame crosses the pause boundary', () => {
    const encoded = encodeControlFrame({
      kind: 'request',
      id: 'request-1',
      protocolVersion: { major: 1, minor: 0 },
      sentAt: '2026-07-27T15:00:00.000Z',
      method: 'session.create',
      payload: { profileId: 'shell-1' },
    });
    const decoder = new FrameDecoder({
      maxFrameBytes: 4096,
      maxBufferedBytes: 4096,
      pauseAtBufferedBytes: 8,
    });

    expect(decoder.push(encoded.subarray(0, 8))).toEqual([]);
    expect(decoder.shouldPause).toBe(true);
    expect(decoder.push(encoded.subarray(8))).toHaveLength(1);
    expect(decoder.shouldPause).toBe(false);
  });

  it('rejects incomplete buffered data beyond the hard buffer boundary', () => {
    const partial = Buffer.alloc(13);
    partial.writeUInt32BE(100, 0);
    const decoder = new FrameDecoder({
      maxFrameBytes: 100,
      maxBufferedBytes: 12,
      pauseAtBufferedBytes: 6,
    });

    try {
      decoder.push(partial);
      throw new Error('expected a framing error');
    } catch (error) {
      expect(error).toBeInstanceOf(FramingError);
      expect(error).toMatchObject({ code: 'resource_exhausted' });
    }
  });

  it('normalizes malformed input to invalid_frame', () => {
    const invalidUtf8Session = Buffer.alloc(16);
    invalidUtf8Session.writeUInt32BE(12, 0);
    invalidUtf8Session[4] = 2;
    invalidUtf8Session.writeUInt16BE(1, 5);
    invalidUtf8Session[7] = 0xff;
    const malformedFrames = [
      Buffer.from([0, 0, 0, 0]),
      Buffer.from([0, 0, 0, 1, 99]),
      Buffer.from([0, 0, 0, 2, 1, 123]),
      Buffer.from([0, 0, 0, 1, 2]),
      invalidUtf8Session,
    ];

    for (const frame of malformedFrames) {
      try {
        new FrameDecoder().push(frame);
        throw new Error('expected a framing error');
      } catch (error) {
        expect(error).toBeInstanceOf(FramingError);
        expect(error).toMatchObject({ code: 'invalid_frame' });
      }
    }
  });

  it('rejects invalid framing limits at construction time', () => {
    expect(() => new FrameDecoder({ maxFrameBytes: 0 })).toThrow(RangeError);
    expect(
      () =>
        new FrameDecoder({
          maxFrameBytes: 16,
          maxBufferedBytes: 16,
          pauseAtBufferedBytes: 17,
        }),
    ).toThrow(RangeError);
  });
});
