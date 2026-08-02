import { describe, expect, it } from 'vitest';

import { reconcileTerminalReplay } from './terminal-stream.js';

describe('terminal replay reconciliation', () => {
  it('uses a snapshot after a history gap and keeps only newer live output', () => {
    expect(
      reconcileTerminalReplay(
        {
          historyGap: true,
          snapshot: 'snapshot',
          events: [{ sequence: 4, data: 'old' }],
          oldestSequence: 4,
          nextSequence: 6,
        },
        [
          { sessionId: 'session-1', sequence: 5, data: 'duplicate' },
          { sessionId: 'session-1', sequence: 6, data: 'new' },
        ],
      ),
    ).toEqual({ chunks: ['snapshot', 'new'], lastSequence: 6 });
  });

  it('replays incremental events in sequence order', () => {
    expect(
      reconcileTerminalReplay(
        {
          historyGap: false,
          events: [
            { sequence: 2, data: 'two' },
            { sequence: 1, data: 'one' },
          ],
          nextSequence: 3,
        },
        [],
      ),
    ).toEqual({ chunks: ['one', 'two'], lastSequence: 2 });
  });
});
