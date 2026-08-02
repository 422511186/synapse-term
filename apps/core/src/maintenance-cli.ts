import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { restoreDatabaseBackup, verifyDatabaseBackup } from './database-backup.js';

export interface CoreMaintenanceIo {
  stdout(line: string): void;
  stderr(line: string): void;
  isCoreRunning(databasePath: string): Promise<boolean>;
  now?: () => Date;
}

const USAGE =
  'Usage: core-maintenance verify-backup <manifest.json> | restore-backup <manifest.json> <core.sqlite>';

export async function runCoreMaintenance(
  argumentsValue: readonly string[],
  io: CoreMaintenanceIo,
): Promise<number> {
  const [command, manifestPath, databasePath, ...extra] = argumentsValue;
  if (command === 'verify-backup' && manifestPath !== undefined && databasePath === undefined) {
    const verification = await verifyDatabaseBackup(manifestPath);
    io.stdout(JSON.stringify(verification));
    return verification.ok ? 0 : 1;
  }
  if (
    command === 'restore-backup' &&
    manifestPath !== undefined &&
    databasePath !== undefined &&
    extra.length === 0
  ) {
    if (await io.isCoreRunning(databasePath)) {
      io.stderr('Core is still running; exit it before restoring a database backup.');
      return 3;
    }
    try {
      const result = await restoreDatabaseBackup(manifestPath, databasePath, {
        ...(io.now === undefined ? {} : { now: io.now }),
      });
      io.stdout(JSON.stringify({ ok: true, ...result }));
      return 0;
    } catch (error) {
      io.stderr(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  io.stderr(USAGE);
  return 2;
}

export async function isCoreRunning(databasePath: string): Promise<boolean> {
  let state: string;
  try {
    state = await readFile(join(dirname(databasePath), 'upgrade-state.ini'), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
  const values = new Map(
    state
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('['))
      .map((line) => {
        const separator = line.indexOf('=');
        return separator < 0 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
  if (values.get('running') !== '1') return false;
  const pid = Number(values.get('pid'));
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    return true;
  }
}
