import { describe, expect, it } from 'vitest';

import { CommandOutputCollector } from './command-output-collector.js';

describe('CommandOutputCollector', () => {
  it('removes ANSI and split OSC control frames while preserving the output cursor', () => {
    const collector = new CommandOutputCollector({ maxBytes: 100 });

    collector.append(4, 'hello\u001b[31m red\u001b[0m\ncontrol\n\u001b]777;TA;nonce');
    collector.append(5, '-1;0\u0007visible\n');

    expect(collector.snapshot()).toMatchObject({
      cursor: 5,
      text: 'hello red\ncontrol\nvisible\n',
      truncated: false,
    });
  });

  it('removes a printable completion marker even when it is split across chunks', () => {
    const collector = new CommandOutputCollector({ maxBytes: 100 });
    collector.append(1, 'before __TA_DONE_nonce');
    collector.append(2, '-1;0__ after\n');

    expect(collector.snapshot().text).toBe('before  after\n');
  });

  it('collapses repeated progress lines and carriage-return updates', () => {
    const collector = new CommandOutputCollector({ maxBytes: 100 });

    collector.append(1, 'download 1%\rdownload 2%\rdownload 2%\n');
    collector.append(2, 'done\ndone\n');

    expect(collector.snapshot().text).toBe('download 2%\ndone\n');
  });

  it('retains bounded head and tail while reporting total output bytes', () => {
    const collector = new CommandOutputCollector({ maxBytes: 10 });
    collector.append(1, '0123456789abcdef');

    expect(collector.snapshot()).toEqual({
      cursor: 1,
      text: '01234\n...[truncated]...\nbcdef',
      head: '01234',
      tail: 'bcdef',
      totalBytes: 16,
      truncated: true,
    });
  });

  it('counts UTF-8 bytes without splitting a multibyte code point', () => {
    const collector = new CommandOutputCollector({ maxBytes: 5 });
    collector.append(1, '甲乙丙');

    const snapshot = collector.snapshot();
    expect(snapshot.totalBytes).toBe(9);
    expect(Buffer.byteLength(snapshot.head)).toBeLessThanOrEqual(3);
    expect(Buffer.byteLength(snapshot.tail)).toBeLessThanOrEqual(2);
  });
});
