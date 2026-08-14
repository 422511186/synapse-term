import { describe, expect, it } from 'vitest';

import { splitUtf8 } from './output-frame.js';

describe('splitUtf8', () => {
  it('splits plain text by byte budget', () => {
    expect(splitUtf8('abcdef', 3)).toEqual(['abc', 'def']);
  });

  it('keeps multibyte characters intact', () => {
    const chunks = splitUtf8('你好世界', 5);
    expect(chunks.every((chunk) => Buffer.byteLength(chunk, 'utf8') <= 5)).toBe(true);
    expect(chunks.join('')).toBe('你好世界');
  });

  it('returns empty for empty input', () => {
    expect(splitUtf8('', 10)).toEqual([]);
  });
});
