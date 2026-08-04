import { describe, expect, it } from 'vitest';

import type { SessionSummary } from '../preload/preload-api.js';
import { getSessionAvailability } from './session-status.js';

function session(
  pty: SessionSummary['pty'],
  shell: SessionSummary['shell'],
  agentStatus?: string,
): SessionSummary {
  return {
    id: `${pty}-${shell}`,
    title: '终端',
    terminalType: 'Git Bash',
    pty,
    shell,
    executionDialect: 'posix',
    ...(agentStatus === undefined ? {} : { agentStatus }),
  };
}

describe('session terminal availability', () => {
  it('maps terminal lifecycle states to stable status tones', () => {
    expect(getSessionAvailability(session('failed', 'unknown'))).toEqual(
      expect.objectContaining({ tone: 'error' }),
    );
    expect(getSessionAvailability(session('exited', 'unknown'))).toEqual(
      expect.objectContaining({ tone: 'muted' }),
    );
    expect(getSessionAvailability(session('running', 'ready'))).toEqual(
      expect.objectContaining({ tone: 'ready' }),
    );
    expect(getSessionAvailability(session('starting', 'unknown'))).toEqual(
      expect.objectContaining({ tone: 'busy' }),
    );
    expect(getSessionAvailability(session('running', 'probing'))).toEqual(
      expect.objectContaining({ tone: 'busy' }),
    );
  });

  it('does not change terminal status when the Agent turn is active', () => {
    expect(getSessionAvailability(session('running', 'ready', 'running'))).toEqual(
      getSessionAvailability(session('running', 'ready', 'idle')),
    );
  });
});
