import type { ITerminalOptions } from '@xterm/xterm';

export const prototypeTerminalMetrics = {
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: 14,
  lineHeight: 1.625,
  padding: 20,
} as const;

export const prototypeTerminalOptions: ITerminalOptions = {
  cursorBlink: true,
  screenReaderMode: true,
  fontFamily: prototypeTerminalMetrics.fontFamily,
  fontSize: prototypeTerminalMetrics.fontSize,
  letterSpacing: 0,
  lineHeight: prototypeTerminalMetrics.lineHeight,
  scrollback: 10_000,
};
