import { describe, expect, it } from 'vitest';

import type { SessionSummary } from './preload-api.js';
import { chooseInitialSessionId, isInteractiveSession } from './session-selection.js';

function session(id: string, pty: SessionSummary['pty']): SessionSummary {
  return {
    id,
    title: id,
    terminalType: 'zsh',
    pty,
    shell: pty === 'running' ? 'ready' : 'unknown',
    executionDialect: 'posix',
  };
}

describe('session selection', () => {
  it('does not select an interrupted or exited history session on startup', () => {
    expect(
      chooseInitialSessionId([
        session('stale-interrupted', 'interrupted'),
        session('live-session', 'running'),
      ]),
    ).toBe('live-session');
  });

  it('returns no default session when only stale sessions remain', () => {
    expect(chooseInitialSessionId([session('stale', 'interrupted')])).toBe('');
    expect(isInteractiveSession(session('stale', 'failed'))).toBe(false);
  });
});
