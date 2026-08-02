import { access } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { withTemporaryDirectory } from '@synapse-term/test-kit';

import type { UnsupportedSchemaVersionError } from './sqlite-store.js';
import { restoreDatabaseBackup, SqliteStore, verifyDatabaseBackup } from './sqlite-store.js';

describe('SqliteStore', () => {
  it('opens in WAL mode, applies migrations, and reports the schema version', async () => {
    await withTemporaryDirectory(async (directory) => {
      const databasePath = join(directory, 'core.sqlite');
      const store = new SqliteStore(databasePath, [
        {
          version: 1,
          migrate: (database) => {
            database.exec('CREATE TABLE sample (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
          },
        },
      ]);

      await store.open();
      expect(store.schemaVersion).toBe(1);
      expect(store.pragma('journal_mode')).toBe('wal');
      expect(store.pragma('foreign_keys')).toBe(1);
      await store.close();
    });
  });

  it('commits successful transactions and rolls back failures', async () => {
    await withTemporaryDirectory(async (directory) => {
      const databasePath = join(directory, 'core.sqlite');
      const migrations = [
        {
          version: 1,
          migrate: (
            database: Parameters<SqliteStore['transaction']>[0] extends (arg: infer T) => unknown
              ? T
              : never,
          ) => {
            database.exec('CREATE TABLE entries (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
          },
        },
      ];
      const first = new SqliteStore(databasePath, migrations);
      await first.open();
      first.transaction((database) => {
        database.prepare('INSERT INTO entries VALUES (?, ?)').run('one', 'committed');
      });
      expect(() =>
        first.transaction((database) => {
          database.prepare('INSERT INTO entries VALUES (?, ?)').run('two', 'rolled-back');
          throw new Error('abort');
        }),
      ).toThrow('abort');
      expect(first.database().prepare('SELECT COUNT(*) AS count FROM entries').get()).toMatchObject(
        {
          count: 1,
        },
      );
      await first.close();

      const second = new SqliteStore(databasePath, migrations);
      await second.open();
      const backupPath = second.backupPath;
      const schemaVersion = second.schemaVersion;
      await second.close();
      expect(backupPath).toBeUndefined();
      expect(schemaVersion).toBe(1);
    });
  });

  it('creates a versioned verified backup before migration and restores it offline', async () => {
    await withTemporaryDirectory(async (directory) => {
      const databasePath = join(directory, 'core.sqlite');
      const backupDirectory = join(directory, 'backups');
      const versionOne = [
        {
          version: 1,
          migrate: (database: DatabaseSync) => {
            database.exec('CREATE TABLE entries (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
          },
        },
      ];
      const first = new SqliteStore(databasePath, versionOne);
      await first.open();
      first.database().prepare('INSERT INTO entries VALUES (?, ?)').run('one', 'preserved');
      await first.close();

      const upgraded = new SqliteStore(
        databasePath,
        [
          ...versionOne,
          {
            version: 2,
            migrate: (database) => {
              database.exec('ALTER TABLE entries ADD COLUMN note TEXT');
            },
          },
        ],
        {
          backupDirectory,
          now: () => new Date('2026-07-28T02:30:00.000Z'),
        },
      );
      await upgraded.open();
      const schemaVersion = upgraded.schemaVersion;
      const backupPath = upgraded.backupPath;
      const backupManifestPath = upgraded.backupManifestPath;
      await upgraded.close();

      expect(schemaVersion).toBe(2);
      expect(backupPath).toContain('rollback-v1-to-v2-20260728T023000000Z.sqlite');
      await expect(access(backupPath!)).resolves.toBeUndefined();
      await expect(access(backupManifestPath!)).resolves.toBeUndefined();
      await expect(verifyDatabaseBackup(backupManifestPath!)).resolves.toMatchObject({
        ok: true,
        schemaVersion: 1,
      });

      await restoreDatabaseBackup(backupManifestPath!, databasePath, {
        now: () => new Date('2026-07-28T02:31:00.000Z'),
      });
      const restored = new SqliteStore(databasePath, versionOne);
      await restored.open();
      expect(restored.schemaVersion).toBe(1);
      expect(restored.database().prepare('SELECT * FROM entries').get()).toMatchObject({
        id: 'one',
        value: 'preserved',
      });
      await restored.close();
    });
  });

  it('rejects a database newer than the supported schema without replacing rollback evidence', async () => {
    await withTemporaryDirectory(async (directory) => {
      const databasePath = join(directory, 'core.sqlite');
      const database = new DatabaseSync(databasePath);
      database.exec('CREATE TABLE future_data (value TEXT); PRAGMA user_version = 3');
      database.close();

      const store = new SqliteStore(databasePath, [
        { version: 1, migrate: () => undefined },
        { version: 2, migrate: () => undefined },
      ]);
      let openError: unknown;
      try {
        await store.open();
      } catch (error) {
        openError = error;
      } finally {
        await store.close();
      }
      expect(openError).toEqual(
        expect.objectContaining<Partial<UnsupportedSchemaVersionError>>({
          name: 'UnsupportedSchemaVersionError',
          databaseVersion: 3,
          supportedVersion: 2,
        }),
      );
      expect(store.backupPath).toBeUndefined();
      expect(store.backupManifestPath).toBeUndefined();
    });
  });
});
