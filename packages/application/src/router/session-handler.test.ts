import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CORE_MIGRATIONS, CoreRepositories, SqliteStore } from '@synapse-term/infrastructure';
import { OutputJournal, SessionManager, type PtySpawner } from '@synapse-term/terminal-service';
import { FakePty, withTemporaryDirectory } from '@synapse-term/test-kit';

import { CoreRequestRouter } from './core-request-router.js';

class FakeSpawner implements PtySpawner {
  readonly ptys: FakePty[] = [];

  spawn(): FakePty {
    const pty = new FakePty(this.ptys.length + 1);
    this.ptys.push(pty);
    return pty;
  }
}

const launch = {
  title: 'local shell',
  terminalType: 'Git Bash',
  executable: 'bash.exe',
  args: ['-i'],
  cwd: 'C:/work',
  env: {},
  columns: 80,
  rows: 24,
  executionDialect: 'posix' as const,
};

async function withRouter(
  callback: (context: {
    router: CoreRequestRouter;
    sessions: SessionManager;
    spawner: FakeSpawner;
    audit: Array<{ type: string; sessionId?: string; payload: Record<string, unknown> }>;
  }) => Promise<void>,
) {
  await withTemporaryDirectory(async (directory) => {
    const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
    await store.open();
    const repositories = new CoreRepositories(store);
    const spawner = new FakeSpawner();
    const journal = new OutputJournal();
    const sessions = new SessionManager(spawner);
    const audit: Array<{ type: string; sessionId?: string; payload: Record<string, unknown> }> = [];
    const router = new CoreRequestRouter({
      sessions,
      journal,
      repositories,
      emitTerminalOutput: () => undefined,
      audit: {
        query: () => [],
        record: (input) => audit.push(input),
      },
      shareProbe: { timeoutMs: 5_000 },
    });
    await callback({ router, sessions, spawner, audit });
    await store.close();
  });
}

async function waitFor(
  condition: () => boolean,
  label: string,
  settle?: () => Promise<void>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    await settle?.();
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe('SessionRequestHandler share probe', () => {
  it('auto-probes a newly shared session and marks it ready', async () => {
    await withRouter(async ({ router, sessions, spawner, audit }) => {
      const created = await router.handle('session.create', launch, 'connection-1');
      const sessionId = (created as { id: string }).id;
      const pty = spawner.ptys[0]!;
      const actor = sessions.get(sessionId);
      if (actor === undefined) throw new Error('expected session actor');

      await router.handle('session.markShared', { sessionId }, 'connection-1');

      await waitFor(
        () => pty.writes.join('').includes('__TA_DIALECT_'),
        'dialect probe',
        () => actor.idle(),
      );
      const dialectNonce = pty.writes.join('').match(/__TA_DIALECT_([A-Za-z0-9-]+)__/)?.[1];
      if (dialectNonce === undefined) throw new Error('expected dialect nonce');
      pty.emitData(`__TA_DIALECT_${dialectNonce}__:zsh\r`);

      await waitFor(
        () => pty.writes.join('').includes('__TA_OS_'),
        'os probe',
        () => actor.idle(),
      );
      const osNonce = pty.writes.join('').match(/__TA_OS_([A-Za-z0-9-]+)__/)?.[1];
      if (osNonce === undefined) throw new Error('expected os nonce');
      pty.emitData(`__TA_OS_${osNonce}__:Linux\r`);
      pty.emitData(`\u001b]777;TA;${osNonce};0\u0007`);

      await waitFor(
        () => actor.snapshot.shell === 'ready',
        'shell ready',
        () => actor.idle(),
      );
      expect(audit.some((entry) => entry.type === 'session.probe')).toBe(true);
    });
  });

  it('keeps sharing non-blocking when the auto probe cannot get a lease', async () => {
    await withRouter(async ({ router, sessions, audit }) => {
      const created = await router.handle('session.create', launch, 'connection-1');
      const sessionId = (created as { id: string }).id;
      const actor = sessions.get(sessionId);
      if (actor === undefined) throw new Error('expected session actor');
      const lease = await actor.grantAgentLease('task-1', actor.snapshot.lease.epoch);
      if (!lease.ok) throw new Error('expected agent lease');

      await router.handle('session.markShared', { sessionId }, 'connection-1');

      await waitFor(
        () => audit.some((entry) => entry.type === 'session.probe'),
        'probe audit',
        () => actor.idle(),
      );
      expect(actor.snapshot.shell).toBe('unknown');
      expect(audit.at(-1)).toMatchObject({
        type: 'session.probe',
        sessionId,
        payload: { phase: 'share', outcome: 'skipped' },
      });
    });
  });
});
