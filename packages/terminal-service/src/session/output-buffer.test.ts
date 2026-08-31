import { describe, expect, it } from 'vitest';

import { OutputBuffer } from './output-buffer.js';

describe('OutputBuffer', () => {
  it('keeps output ordered and reports the latest cursor', () => {
    const buffer = new OutputBuffer({ maxBytes: 1_024 });
    buffer.append(2, 'first ');
    buffer.append(5, 'second');

    expect(buffer.snapshot()).toMatchObject({
      cursor: 5,
      text: 'first second',
      totalBytes: 12,
      truncated: false,
    });
  });

  it('removes terminal control sequences while preserving visible text', () => {
    const buffer = new OutputBuffer();
    buffer.append(1, '\x1b[31mready\x1b[0m');

    expect(buffer.snapshot().text).toBe('ready');
  });

  it('bounds long output with head and tail windows', () => {
    const buffer = new OutputBuffer({ maxBytes: 20 });
    buffer.append(1, 'a'.repeat(30));

    const output = buffer.snapshot();
    expect(output.truncated).toBe(true);
    expect(output.text).toContain('...[truncated]...');
    expect(Buffer.byteLength(output.head)).toBeLessThanOrEqual(10);
    expect(Buffer.byteLength(output.tail)).toBeLessThanOrEqual(10);
  });
});
