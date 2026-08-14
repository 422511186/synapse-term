import { describe, expect, it } from 'vitest';

import { createSessionState, type TerminalBackend } from './index.js';

describe('module public API', () => {
  it('exports session and terminal contracts', () => {
    expect(typeof createSessionState).toBe('function');
    const backend: TerminalBackend = {
      pid: 1,
      write: () => undefined,
      resize: () => undefined,
      interrupt: () => undefined,
      terminate: () => undefined,
      onData: () => ({ dispose: () => undefined }),
      onExit: () => ({ dispose: () => undefined }),
    };
    expect(backend.pid).toBe(1);
  });
});
