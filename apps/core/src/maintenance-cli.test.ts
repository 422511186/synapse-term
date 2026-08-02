import { writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { withTemporaryDirectory } from '@synapse-term/test-kit';

import { createDatabaseBackup } from '@synapse-term/infrastructure';
import { isCoreRunning, runCoreMaintenance } from './maintenance-cli.js';

describe('Core maintenance CLI', () => {
  it('verifies rollback artifacts and restores them only while Core is stopped', async () => {
    await withTemporaryDirectory(async (directory) => {
      const databasePath = join(directory, 'core.sqlite');
      const database = new DatabaseSync(databasePath);
      database.exec(
        'CREATE TABLE entries (id TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version = 1',
      );
      database.prepare('INSERT INTO entries VALUES (?, ?)').run('one', 'before-upgrade');
      const backup = await createDatabaseBackup(database, {
        databasePath,
        backupDirectory: join(directory, 'backups'),
        sourceSchemaVersion: 1,
        targetSchemaVersion: 2,
        now: () => new Date('2026-07-28T04:00:00.000Z'),
      });
      database.exec('ALTER TABLE entries ADD COLUMN note TEXT; PRAGMA user_version = 2');
      database.close();

      const output: string[] = [];
      const errors: string[] = [];
      await expect(
        runCoreMaintenance(['verify-backup', backup.manifestPath], {
          stdout: (line) => output.push(line),
          stderr: (line) => errors.push(line),
          isCoreRunning: async () => false,
        }),
      ).resolves.toBe(0);
      expect(JSON.parse(output.at(-1)!)).toMatchObject({ ok: true, schemaVersion: 1 });
      expect(errors).toEqual([]);

      await expect(
        runCoreMaintenance(['restore-backup', backup.manifestPath, databasePath], {
          stdout: (line) => output.push(line),
          stderr: (line) => errors.push(line),
          isCoreRunning: async () => true,
        }),
      ).resolves.toBe(3);
      expect(errors.at(-1)).toContain('Core is still running');
      const stillUpgraded = new DatabaseSync(databasePath, { readOnly: true });
      expect(readSchemaVersion(stillUpgraded)).toBe(2);
      stillUpgraded.close();

      await expect(
        runCoreMaintenance(['restore-backup', backup.manifestPath, databasePath], {
          stdout: (line) => output.push(line),
          stderr: (line) => errors.push(line),
          isCoreRunning: async () => false,
          now: () => new Date('2026-07-28T04:01:00.000Z'),
        }),
      ).resolves.toBe(0);
      expect(JSON.parse(output.at(-1)!)).toMatchObject({
        ok: true,
        restoredSchemaVersion: 1,
      });
      const restored = new DatabaseSync(databasePath, { readOnly: true });
      expect(readSchemaVersion(restored)).toBe(1);
      expect(restored.prepare('SELECT * FROM entries').get()).toMatchObject({
        id: 'one',
        value: 'before-upgrade',
      });
      restored.close();
    });
  });

  it('returns a usage error for unsupported commands', async () => {
    const errors: string[] = [];
    await expect(
      runCoreMaintenance(['unknown'], {
        stdout: () => undefined,
        stderr: (line) => errors.push(line),
        isCoreRunning: async () => false,
      }),
    ).resolves.toBe(2);
    expect(errors.at(-1)).toContain('Usage:');
  });

  it('detects a live Core from the upgrade state file without trusting a stopped marker', async () => {
    await withTemporaryDirectory(async (directory) => {
      const databasePath = join(directory, 'core.sqlite');
      const statePath = join(directory, 'upgrade-state.ini');
      await writeFile(statePath, `[core]\nrunning=1\npid=${String(process.pid)}\n`, 'utf8');
      await expect(isCoreRunning(databasePath)).resolves.toBe(true);

      await writeFile(statePath, `[core]\nrunning=0\npid=${String(process.pid)}\n`, 'utf8');
      await expect(isCoreRunning(databasePath)).resolves.toBe(false);
    });
  });
});

function readSchemaVersion(database: DatabaseSync): number {
  const row = database.prepare('PRAGMA user_version').get() as Record<string, number | bigint>;
  return Number(row.user_version);
}
