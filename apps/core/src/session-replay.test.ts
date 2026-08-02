import { describe, expect, it } from 'vitest';

import { OutputJournal } from './output-journal.js';
import { SessionReplay } from './session-replay.js';
import { TerminalModel } from './terminal-model.js';

describe('SessionReplay', () => {
  it('returns incremental output and a snapshot after history truncation', async () => {
    const journal = new OutputJournal({ maxSessionBytes: 4, maxGlobalBytes: 4 });
    const terminal = new TerminalModel({ columns: 40, rows: 5, scrollback: 10 });
    const replay = new SessionReplay('session-1', journal, terminal);
    await replay.ingest('one\r\n');
    await replay.ingest('two\r\n');

    const incremental = replay.replay(1);
    expect(incremental.historyGap).toBe(true);
    expect(incremental.snapshot).toContain('one');
    expect(incremental.events.map((event) => event.sequence)).toEqual([]);
    terminal.dispose();
  });
});
