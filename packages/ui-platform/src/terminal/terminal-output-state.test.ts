import { describe, expect, it } from 'vitest';

import { containsTerminalClearSequence } from './terminal-output-state.js';

describe('terminal output state', () => {
  it('recognizes full-screen ANSI clear sequences', () => {
    expect(containsTerminalClearSequence('\u001b[2J\u001b[H')).toBe(true);
    expect(containsTerminalClearSequence('\u001b[3J')).toBe(true);
    expect(containsTerminalClearSequence('normal output')).toBe(false);
  });

  it('does not treat cursor movement or line erase as a scrollback reset', () => {
    expect(containsTerminalClearSequence('\u001b[H')).toBe(false);
    expect(containsTerminalClearSequence('\u001b[2K')).toBe(false);
  });
});
