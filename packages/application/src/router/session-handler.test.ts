import { join } from 'node:path';
import type * as NodeCrypto from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

const randomUUID = vi.hoisted(() => {
  let counter = 0;
  return vi.fn(() => `generated-session-${++counter}`);
});

vi.mock('node:crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeCrypto>()),
  randomUUID,
}));

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

describe('SessionRequestHandler session aliases', () => {
  it('rejects a whitespace-only alias at the Core boundary', async () => {
    await withRouter(async ({ router }) => {
      await expect(
        router.handle('session.create', { ...launch, title: ' \t ' }, 'connection-1'),
      ).rejects.toThrow();
    });
  });

  it('allows duplicate aliases while keeping distinct session identities', async () => {
    await withRouter(async ({ router }) => {
      const first = (await router.handle(
        'session.create',
        { ...launch, title: '同名会话' },
        'connection-1',
      )) as { id: string; title: string };
      const second = (await router.handle(
        'session.create',
        { ...launch, title: '不同别名' },
        'connection-1',
      )) as { id: string; title: string };

      const renamed = (await router.handle(
        'session.rename',
        { sessionId: second.id, alias: '同名会话' },
        'connection-1',
      )) as { id: string; title: string };

      expect(first).toMatchObject({ title: '同名会话' });
      expect(renamed).toMatchObject({ id: second.id, title: '同名会话' });
      expect(second.id).not.toBe(first.id);
    });
  });

  it('renames an alias without changing the addressed sessionId', async () => {
    await withRouter(async ({ router }) => {
      const created = (await router.handle(
        'session.create',
        { ...launch, title: '原始别名' },
        'connection-1',
      )) as { id: string };

      await expect(
        router.handle('session.rename', { sessionId: created.id, alias: '新别名' }, 'connection-1'),
      ).resolves.toMatchObject({ id: created.id, title: '新别名' });
    });
  });

  it('returns sessions in creation order instead of UUID order', async () => {
    randomUUID
      .mockClear()
      .mockReturnValueOnce('session-2')
      .mockReturnValueOnce('session-1')
      .mockReturnValueOnce('session-3');

    await withRouter(async ({ router }) => {
      await router.handle('session.create', { ...launch, title: '先创建' }, 'connection-1');
      await router.handle('session.create', { ...launch, title: '后创建' }, 'connection-1');
      await router.handle('session.create', { ...launch, title: '最后创建' }, 'connection-1');

      const sessions = (await router.handle('session.list', {}, 'connection-1')) as Array<{
        id: string;
        title: string;
      }>;
      expect(sessions.map((session) => [session.id, session.title])).toEqual([
        ['session-2', '先创建'],
        ['session-1', '后创建'],
        ['session-3', '最后创建'],
      ]);
    });
  });
});
