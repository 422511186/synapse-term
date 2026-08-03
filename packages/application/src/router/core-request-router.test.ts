import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FakePty, withTemporaryDirectory } from '@synapse-term/test-kit';
import type { PtySpawner } from '@synapse-term/terminal-service';
import { CORE_MIGRATIONS } from '@synapse-term/infrastructure';
import { CoreRepositories } from '@synapse-term/infrastructure';
import { CoreRequestRouter } from './core-request-router.js';
import { OutputJournal } from '@synapse-term/terminal-service';
import { SessionManager } from '@synapse-term/terminal-service';
import { SqliteStore } from '@synapse-term/infrastructure';
import { MAX_TERMINAL_OUTPUT_CHUNK_BYTES, MAX_TERMINAL_REPLAY_BYTES } from '@synapse-term/protocol';

class FakeSpawner implements PtySpawner {
  readonly ptys: FakePty[] = [];
  initialData: string | undefined;

  spawn(): FakePty {
    const pty = new FakePty(this.ptys.length + 1);
    this.ptys.push(pty);
    if (this.initialData !== undefined) {
      const data = this.initialData;
      const onData = pty.onData.bind(pty);
      pty.onData = (listener) => {
        const subscription = onData(listener);
        listener(data);
        return subscription;
      };
    }
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

describe('CoreRequestRouter terminal methods', () => {
  it('creates a Session, forwards user IO, journals output, and replays it', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const repositories = new CoreRepositories(store);
      const spawner = new FakeSpawner();
      const journal = new OutputJournal();
      const sessions = new SessionManager(spawner);
      const outputs: Array<{ sessionId: string; sequence: number; data: string }> = [];
      const changes: unknown[] = [];
      const auditRecords: Array<{ type: string }> = [];
      const activity: Array<{ sessions: number; agentTasks: number }> = [];
      const router = new CoreRequestRouter({
        sessions,
        journal,
        repositories,
        emitTerminalOutput: (event) => outputs.push(event),
        emitEvent: (event) => changes.push(event),
        audit: {
          query: () => [],
          record: (input: { type: string }) => auditRecords.push(input),
        },
        onActivityChange: (next) => activity.push(next),
      });

      const created = await router.handle('session.create', launch, 'connection-1');
      expect(created).toMatchObject({
        id: expect.any(String),
        title: 'local shell',
        terminalType: 'Git Bash',
        pty: 'running',
      });
      const sessionId = (created as { id: string }).id;
      expect(await router.handle('session.list', {}, 'connection-1')).toMatchObject([
        {
          id: sessionId,
          title: 'local shell',
          terminalType: 'Git Bash',
          executionDialect: 'posix',
        },
      ]);
      await expect(
        router.handle(
          'session.setDialect',
          { sessionId, executionDialect: 'powershell' },
          'connection-1',
        ),
      ).resolves.toMatchObject({ executionDialect: 'powershell', shell: 'unknown' });
      expect(repositories.getSession(sessionId)?.executionDialect).toBe('powershell');
      const columns = (
        store.database().prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
      ).map((column) => column.name);
      const metadata =
        columns.includes('title') && columns.includes('launch_json')
          ? (store
              .database()
              .prepare('SELECT title, launch_json FROM sessions WHERE id = ?')
              .get(sessionId) as { title: string; launch_json: string })
          : undefined;
      const reconstructed = new CoreRequestRouter({
        sessions,
        journal,
        repositories,
        emitTerminalOutput: () => undefined,
      });
      const reconstructedSessions = await reconstructed.handle('session.list', {}, 'connection-2');

      const pty = spawner.ptys[0]!;
      pty.emitData('prompt$ ');
      await router.idle();
      expect(outputs).toEqual([{ sessionId, sequence: 1, data: 'prompt$ ' }]);
      expect(
        await router.handle('terminal.replay', { sessionId, afterSequence: 0 }, 'connection-1'),
      ).toMatchObject({
        historyGap: false,
        events: [{ sequence: 1, data: 'prompt$ ' }],
      });

      await router.handle('terminal.write', { sessionId, data: 'pwd\r' }, 'connection-1');
      expect(pty.writes).toEqual(['pwd\r']);
      await router.handle('terminal.resize', { sessionId, columns: 120, rows: 40 }, 'connection-1');
      expect(pty.resizes).toEqual([{ columns: 120, rows: 40 }]);
      expect(changes.some((event) => (event as { type?: string }).type === 'session.changed')).toBe(
        true,
      );

      pty.emitExit({ exitCode: 0 });
      await router.idle();
      await Promise.resolve();
      expect(repositories.getSession(sessionId)?.pty).toBe('exited');
      const activityAfterExit = activity.at(-1);

      const closed = await router.handle('session.close', { sessionId }, 'connection-1');
      const persisted = repositories.getSession(sessionId);
      await store.close();
      expect(closed).toBe(true);
      expect(persisted).toBeUndefined();
      expect(columns).toEqual(expect.arrayContaining(['title', 'launch_json']));
      expect(metadata).toMatchObject({ title: 'local shell' });
      expect(JSON.parse(metadata!.launch_json)).toMatchObject({
        terminalType: 'Git Bash',
        executable: 'bash.exe',
        args: ['-i'],
        cwd: 'C:/work',
        columns: 80,
        rows: 24,
        envKeys: [],
      });
      expect(reconstructedSessions).toMatchObject([
        { id: sessionId, title: 'local shell', terminalType: 'Git Bash' },
      ]);
      expect(auditRecords.map((record) => record.type)).toEqual(
        expect.arrayContaining(['session.created', 'session.input', 'session.closed']),
      );
      expect(activityAfterExit).toEqual({ sessions: 0, agentTasks: 0 });
    });
  });

  it('captures PTY output emitted before Session creation returns', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const repositories = new CoreRepositories(store);
      const spawner = new FakeSpawner();
      spawner.initialData = 'early prompt$ ';
      const journal = new OutputJournal();
      const outputs: Array<{ sessionId: string; sequence: number; data: string }> = [];
      const router = new CoreRequestRouter({
        sessions: new SessionManager(spawner),
        journal,
        repositories,
        emitTerminalOutput: (event) => outputs.push(event),
      });

      const created = await router.handle('session.create', launch, 'connection-1');
      const sessionId = (created as { id: string }).id;
      await router.idle();
      const replay = await router.handle(
        'terminal.replay',
        { sessionId, afterSequence: 0 },
        'connection-1',
      );
      await router.closeAll();
      await store.close();

      expect(outputs).toEqual([{ sessionId, sequence: 1, data: 'early prompt$ ' }]);
      expect(replay).toMatchObject({
        events: [{ sequence: 1, data: 'early prompt$ ' }],
      });
    });
  });

  it('splits large PTY output into ordered events and paged replay', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const repositories = new CoreRepositories(store);
      const spawner = new FakeSpawner();
      const journal = new OutputJournal();
      const sessions = new SessionManager(spawner);
      const outputs: Array<{ sessionId: string; sequence: number; data: string }> = [];
      const router = new CoreRequestRouter({
        sessions,
        journal,
        repositories,
        emitTerminalOutput: (event) => outputs.push(event),
      });

      const created = await router.handle('session.create', launch, 'connection-1');
      const sessionId = (created as { id: string }).id;
      const pty = spawner.ptys[0]!;
      const largeOutput = '界'.repeat(
        Math.ceil((MAX_TERMINAL_REPLAY_BYTES + MAX_TERMINAL_OUTPUT_CHUNK_BYTES + 1) / 3),
      );
      pty.emitData(largeOutput);
      await router.idle();

      expect(outputs.length).toBeGreaterThan(1);
      expect(outputs.map((event) => event.sequence)).toEqual(outputs.map((_, index) => index + 1));
      expect(outputs.map((event) => event.data).join('')).toBe(largeOutput);
      expect(
        outputs.every(
          (event) => Buffer.byteLength(event.data, 'utf8') <= MAX_TERMINAL_OUTPUT_CHUNK_BYTES,
        ),
      ).toBe(true);

      const replay = await router.handle(
        'terminal.replay',
        { sessionId, afterSequence: 0 },
        'connection-1',
      );
      expect(replay).toMatchObject({ hasMore: true });
      expect((replay as { nextAfterSequence: number }).nextAfterSequence).toBeGreaterThan(0);
      await router.closeAll();
      await store.close();
    });
  });
});
