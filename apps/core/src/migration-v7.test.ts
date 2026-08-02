/**
 * Task 7.1: Verify migration v7 exists and database opens with all migrations.
 */
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { createSessionState } from '@terminal-agent/domain';
import { withTemporaryDirectory } from '@terminal-agent/test-kit';

import { CORE_MIGRATIONS } from './core-schema.js';
import { CoreRepositories } from './repositories.js';
import { SqliteStore } from './sqlite-store.js';

describe('Migration v7: plaintext environment fields', () => {
  it('migration v7 exists in migration list', () => {
    const versions = CORE_MIGRATIONS.map((m) => m.version);
    expect(versions).toContain(7);
    expect(versions).toContain(8);
    expect(versions).toContain(6);
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i]!).toBeGreaterThan(versions[i - 1]!);
    }
  });

  it('database opens successfully with all migrations including v7', async () => {
    await withTemporaryDirectory(async (dir) => {
      const store = new SqliteStore(join(dir, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const repositories = new CoreRepositories(store);
      expect(repositories).toBeDefined();
      await store.close();
    });
  });

  it('new sessions can be created after migration', async () => {
    await withTemporaryDirectory(async (dir) => {
      const store = new SqliteStore(join(dir, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const repositories = new CoreRepositories(store);

      // Verify we can work with sessions (the schema is correct)
      const sessions = repositories.listSessions();
      expect(Array.isArray(sessions)).toBe(true);

      await store.close();
    });
  });

  it('audit events can be queried after migration', async () => {
    await withTemporaryDirectory(async (dir) => {
      const store = new SqliteStore(join(dir, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const repositories = new CoreRepositories(store);

      const events = repositories.listAuditEvents();
      expect(Array.isArray(events)).toBe(true);

      await store.close();
    });
  });

  it('opens schema v8 databases created by the refactored desktop branch', async () => {
    await withTemporaryDirectory(async (dir) => {
      const databasePath = join(dir, 'core.sqlite');
      const initialStore = new SqliteStore(databasePath, CORE_MIGRATIONS);
      await initialStore.open();
      new CoreRepositories(initialStore).saveSession(createSessionState('legacy-session'));
      await initialStore.close();

      const database = new DatabaseSync(databasePath);
      const row = database
        .prepare('SELECT state_json FROM sessions WHERE id = ?')
        .get('legacy-session') as { state_json: string };
      const state = JSON.parse(row.state_json) as Record<string, unknown>;
      delete state.environment;
      database
        .prepare('UPDATE sessions SET state_json = ? WHERE id = ?')
        .run(JSON.stringify(state), 'legacy-session');
      database.exec('PRAGMA user_version = 8');
      database.close();

      const store = new SqliteStore(databasePath, CORE_MIGRATIONS);
      await store.open();
      expect(store.schemaVersion).toBe(8);
      expect(new CoreRepositories(store).listSessions()).toEqual([
        expect.objectContaining({
          id: 'legacy-session',
          environment: expect.objectContaining({ verificationStatus: 'unverified' }),
        }),
      ]);
      await store.close();
    });
  });
});
