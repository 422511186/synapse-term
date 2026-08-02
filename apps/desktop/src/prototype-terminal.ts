import type { ITerminalOptions } from '@xterm/xterm';

export const prototypeTerminalMetrics = {
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: 14,
  lineHeight: 1.625,
  padding: 20,
} as const;

export const prototypeTerminalOptions: ITerminalOptions = {
  cursorBlink: true,
  fontFamily: prototypeTerminalMetrics.fontFamily,
  fontSize: prototypeTerminalMetrics.fontSize,
  letterSpacing: 0,
  lineHeight: prototypeTerminalMetrics.lineHeight,
  scrollback: 10_000,
  theme: {
    background: '#000000',
    foreground: '#d4d4d8',
    cursor: '#34d399',
    cursorAccent: '#000000',
    selectionBackground: '#27272a',
    black: '#000000',
    red: '#f87171',
    green: '#34d399',
    yellow: '#fcd34d',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: '#d4d4d8',
    brightBlack: '#71717a',
    brightWhite: '#f4f4f5',
  },
};
