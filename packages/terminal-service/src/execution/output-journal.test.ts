import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { withTemporaryDirectory } from '@synapse-term/test-kit';

import { OutputJournal } from './output-journal.js';

describe('OutputJournal', () => {
  it('assigns ordered sequences and keeps consumer cursors independent', async () => {
    await withTemporaryDirectory(async (directory) => {
      const journal = new OutputJournal({ directory, maxSessionBytes: 100, maxGlobalBytes: 200 });
      const first = journal.createCursor('session-1');
      const slow = journal.createCursor('session-1');
      expect(journal.append('session-1', Uint8Array.from([1, 2]))).toMatchObject({ sequence: 1 });
      expect(journal.append('session-1', Uint8Array.from([3]))).toMatchObject({ sequence: 2 });

      expect(journal.read(first, 1).events.map((event) => event.sequence)).toEqual([1]);
      expect(journal.read(first, 10).events.map((event) => event.sequence)).toEqual([2]);
      expect(journal.read(slow, 10).events.map((event) => event.sequence)).toEqual([1, 2]);
      await journal.flush();
      expect((await readFile(join(directory, 'session-1.log'), 'utf8')).split('\n')).toHaveLength(
        3,
      );
    });
  });

  it('reports history gaps after per-session and global capacity eviction', async () => {
    const journal = new OutputJournal({ maxSessionBytes: 3, maxGlobalBytes: 4 });
    journal.append('session-1', Uint8Array.from([1, 2]));
    journal.append('session-1', Uint8Array.from([3, 4]));
    const sessionGap = journal.replay('session-1', 0);
    expect(sessionGap.historyGap).toBe(true);
    expect(sessionGap.events.map((event) => event.sequence)).toEqual([2]);

    journal.append('session-2', Uint8Array.from([5, 6, 7]));
    const globalGap = journal.replay('session-1', 1);
    expect(globalGap.historyGap).toBe(true);
  });

  it('returns byte-bounded replay pages with a continuation cursor', () => {
    const journal = new OutputJournal();
    journal.append('session-1', Buffer.from('1234'));
    journal.append('session-1', Buffer.from('5678'));
    journal.append('session-1', Buffer.from('90ab'));

    const first = journal.replay('session-1', 0, Number.MAX_SAFE_INTEGER, 8);
    expect(first.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(first.hasMore).toBe(true);
    expect(first.nextAfterSequence).toBe(2);

    const second = journal.replay('session-1', first.nextAfterSequence, Number.MAX_SAFE_INTEGER, 8);
    expect(second.events.map((event) => event.sequence)).toEqual([3]);
    expect(second.hasMore).toBe(false);
    expect(second.nextAfterSequence).toBe(3);
  });
});
