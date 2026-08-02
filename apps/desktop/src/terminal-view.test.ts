import { describe, expect, it } from 'vitest';

import { TerminalView } from './terminal-view.js';

describe('TerminalView', () => {
  it('is importable with the prototype terminal options', () => {
    expect(TerminalView).toBeTypeOf('function');
  });
});
