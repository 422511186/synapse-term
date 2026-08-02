import { describe, expect, it } from 'vitest';

import { prototypeTerminalMetrics, prototypeTerminalOptions } from './prototype-terminal.js';

describe('prototype terminal presentation', () => {
  it('locks the xterm canvas to the prototype font metrics and colors', () => {
    expect(prototypeTerminalMetrics).toEqual({
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 14,
      lineHeight: 1.625,
      padding: 20,
    });
    expect(prototypeTerminalOptions).toMatchObject({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 14,
      lineHeight: 1.625,
      letterSpacing: 0,
      theme: {
        background: '#000000',
        foreground: '#d4d4d8',
        cursor: '#34d399',
        cursorAccent: '#000000',
        selectionBackground: '#27272a',
      },
    });
  });
});
