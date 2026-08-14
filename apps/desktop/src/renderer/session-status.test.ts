import { describe, expect, it } from 'vitest';

import type { SessionSummary } from '../preload/preload-api.js';
import { getSessionAvailability } from './session-status.js';

function session(pty: SessionSummary['pty']): SessionSummary {
  return {
    id: `session-${pty}`,
    title: '终端',
    terminalType: 'Git Bash',
    pty,
  };
}

describe('session terminal availability', () => {
  it('maps terminal lifecycle states to stable status tones', () => {
    expect(getSessionAvailability(session('failed'))).toEqual(
      expect.objectContaining({ tone: 'error' }),
    );
    expect(getSessionAvailability(session('exited'))).toEqual(
      expect.objectContaining({ tone: 'muted' }),
    );
    expect(getSessionAvailability(session('running'))).toEqual(
      expect.objectContaining({ tone: 'ready' }),
    );
    expect(getSessionAvailability(session('starting'))).toEqual(
      expect.objectContaining({ tone: 'busy' }),
    );
  });
});
