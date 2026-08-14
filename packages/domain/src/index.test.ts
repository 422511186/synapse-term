import { describe, expect, it } from 'vitest';

import { createSessionState, transitionSessionPty } from './index.js';

describe('domain public API', () => {
  it('exposes session state helpers', () => {
    const state = createSessionState({
      id: 'session-1',
      title: '终端 1',
      terminalType: 'Zsh',
    });
    expect(state.pty).toBe('starting');
    const running = transitionSessionPty(state, 'running');
    expect(running).toEqual({ ok: true, value: expect.objectContaining({ pty: 'running' }) });
  });
});
