import { describe, expect, it } from 'vitest';

import { splitTerminalOutput } from './output-frame.js';

describe('splitTerminalOutput', () => {
  it('splits plain text by byte budget', () => {
    expect(splitTerminalOutput('abcdef', 3).chunks).toEqual(['abc', 'def']);
  });

  it('keeps multibyte characters intact', () => {
    const { chunks, carry } = splitTerminalOutput('你好世界', 5);
    expect(chunks.every((chunk) => Buffer.byteLength(chunk, 'utf8') <= 5)).toBe(true);
    expect(chunks.join('')).toBe('你好世界');
    expect(carry).toBe('');
  });

  it('returns empty for empty input', () => {
    expect(splitTerminalOutput('', 10)).toEqual({ chunks: [], carry: '' });
  });

  it('keeps CSI escape sequences intact across chunk boundaries', () => {
    const data = `aaaa\x1b[31mred`;
    const { chunks, carry } = splitTerminalOutput(data, 3);
    expect(chunks.some((chunk) => chunk.includes('\x1b[31m'))).toBe(true);
    expect(carry).toBe('');
  });

  it('carries an incomplete escape sequence to the next chunk', () => {
    const first = splitTerminalOutput('abc\x1b[31', 64);
    expect(first.chunks).toEqual(['abc']);
    expect(first.carry).toBe('\x1b[31');
    const second = splitTerminalOutput('mred', 64, first.carry);
    expect(second.chunks).toEqual(['\x1b[31mred']);
    expect(second.carry).toBe('');
  });
});
