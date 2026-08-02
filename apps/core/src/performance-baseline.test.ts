import { describe, expect, it } from 'vitest';

import { FakePty } from '@terminal-agent/test-kit';

import { AgentTaskScheduler } from './agent-task-scheduler.js';
import { OutputJournal } from './output-journal.js';
import type { PtySpawnOptions, PtySpawner } from './pty-adapter.js';
import { SessionManager } from './session-manager.js';

class StressSpawner implements PtySpawner {
  readonly ptys: FakePty[] = [];

  spawn(): FakePty {
    const pty = new FakePty(this.ptys.length + 1);
    this.ptys.push(pty);
    return pty;
  }
}

const launch: PtySpawnOptions = {
  executable: 'bash.exe',
  args: [],
  cwd: 'C:/work',
  env: { TERM: 'xterm-256color' },
  columns: 80,
  rows: 24,
};

describe('performance baselines', () => {
  it('supports 20 idle Sessions and four running Agent Tasks within hard limits', async () => {
    const spawner = new StressSpawner();
    const sessions = new SessionManager(spawner, { maxSessions: 20 });
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        sessions.create({ id: `session-${index + 1}`, launch }),
      ),
    );
    expect(sessions.activeCount).toBe(20);
    await expect(sessions.create({ id: 'session-21', launch })).rejects.toMatchObject({
      code: 'session_limit_reached',
    });

    const scheduler = new AgentTaskScheduler({ maxRunningTasks: 4 });
    for (let index = 1; index <= 4; index += 1) {
      scheduler.create({
        id: `task-${index}`,
        sessionId: `session-${index}`,
        providerProfileId: 'provider-1',
        goal: 'stress test',
      });
      scheduler.start(`task-${index}`);
    }
    expect(scheduler.list().filter((task) => task.status === 'running')).toHaveLength(4);

    await Promise.all(sessions.list().map((session) => sessions.close(session.snapshot.id)));
  });

  it('keeps sustained output bounded even when a consumer never advances', () => {
    const journal = new OutputJournal({ maxSessionBytes: 8 * 1024, maxGlobalBytes: 16 * 1024 });
    const slowCursor = journal.createCursor('session-1');
    const chunk = Buffer.alloc(512, 0x61);
    for (let index = 0; index < 2_000; index += 1) journal.append('session-1', chunk);

    expect(journal.totalBytes).toBeLessThanOrEqual(8 * 1024);
    expect(journal.read(slowCursor, 10)).toMatchObject({ historyGap: true });
  });
});
