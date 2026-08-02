import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite';
import { basename, dirname, join, resolve } from 'node:path';

export interface DatabaseBackupManifest {
  formatVersion: 1;
  createdAt: string;
  sourceDatabasePath: string;
  backupFile: string;
  sourceSchemaVersion: number;
  targetSchemaVersion: number;
  byteLength: number;
  sha256: string;
}

export interface DatabaseBackupArtifact {
  backupPath: string;
  manifestPath: string;
  manifest: DatabaseBackupManifest;
}

export type DatabaseBackupVerification =
  | {
      ok: true;
      backupPath: string;
      schemaVersion: number;
      byteLength: number;
      sha256: string;
    }
  | {
      ok: false;
      error:
        | 'invalid_manifest'
        | 'backup_missing'
        | 'size_mismatch'
        | 'checksum_mismatch'
        | 'schema_mismatch'
        | 'integrity_check_failed';
      message: string;
    };

export interface CreateDatabaseBackupOptions {
  databasePath: string;
  backupDirectory: string;
  sourceSchemaVersion: number;
  targetSchemaVersion: number;
  now?: () => Date;
}

export interface RestoreDatabaseBackupOptions {
  now?: () => Date;
}

export async function createDatabaseBackup(
  database: DatabaseSync,
  options: CreateDatabaseBackupOptions,
): Promise<DatabaseBackupArtifact> {
  const now = options.now?.() ?? new Date();
  const stamp = backupTimestamp(now);
  await mkdir(options.backupDirectory, { recursive: true });
  const backupFile = `${basename(options.databasePath)}.rollback-v${String(
    options.sourceSchemaVersion,
  )}-to-v${String(options.targetSchemaVersion)}-${stamp}.sqlite`;
  const backupPath = join(options.backupDirectory, backupFile);
  const manifestPath = `${backupPath}.json`;

  await sqliteBackup(database, backupPath);
  const metadata = await stat(backupPath);
  const manifest: DatabaseBackupManifest = {
    formatVersion: 1,
    createdAt: now.toISOString(),
    sourceDatabasePath: resolve(options.databasePath),
    backupFile,
    sourceSchemaVersion: options.sourceSchemaVersion,
    targetSchemaVersion: options.targetSchemaVersion,
    byteLength: metadata.size,
    sha256: await sha256File(backupPath),
  };
  await writeJsonAtomically(manifestPath, manifest);
  return { backupPath, manifestPath, manifest };
}

export async function verifyDatabaseBackup(
  manifestPath: string,
): Promise<DatabaseBackupVerification> {
  let manifest: DatabaseBackupManifest;
  try {
    manifest = parseManifest(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    return failure('invalid_manifest', error);
  }
  const backupPath = resolve(dirname(manifestPath), manifest.backupFile);
  try {
    await access(backupPath);
  } catch (error) {
    return failure('backup_missing', error);
  }
  const metadata = await stat(backupPath);
  if (metadata.size !== manifest.byteLength) {
    return {
      ok: false,
      error: 'size_mismatch',
      message: `Backup size ${String(metadata.size)} does not match manifest ${String(manifest.byteLength)}`,
    };
  }
  const hash = await sha256File(backupPath);
  if (hash !== manifest.sha256) {
    return {
      ok: false,
      error: 'checksum_mismatch',
      message: 'Backup SHA-256 does not match its manifest',
    };
  }

  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(backupPath, { readOnly: true });
    const integrity = database.prepare('PRAGMA integrity_check').get() as
      Record<string, unknown> | undefined;
    if (integrity?.integrity_check !== 'ok') {
      return {
        ok: false,
        error: 'integrity_check_failed',
        message: `SQLite integrity check returned ${String(integrity?.integrity_check)}`,
      };
    }
    const schemaVersion = readSchemaVersion(database);
    if (schemaVersion !== manifest.sourceSchemaVersion) {
      return {
        ok: false,
        error: 'schema_mismatch',
        message: `Backup schema ${String(schemaVersion)} does not match manifest ${String(
          manifest.sourceSchemaVersion,
        )}`,
      };
    }
    return {
      ok: true,
      backupPath,
      schemaVersion,
      byteLength: metadata.size,
      sha256: hash,
    };
  } catch (error) {
    return failure('integrity_check_failed', error);
  } finally {
    database?.close();
  }
}

export async function restoreDatabaseBackup(
  manifestPath: string,
  databasePath: string,
  options: RestoreDatabaseBackupOptions = {},
): Promise<{ restoredSchemaVersion: number; rescuePath?: string }> {
  const manifest = parseManifest(await readFile(manifestPath, 'utf8'));
  const resolvedDatabasePath = resolve(databasePath);
  if (resolve(manifest.sourceDatabasePath) !== resolvedDatabasePath) {
    throw new Error('Backup manifest does not belong to the requested database path');
  }
  const verification = await verifyDatabaseBackup(manifestPath);
  if (!verification.ok) {
    throw new Error(`Database backup verification failed: ${verification.message}`);
  }

  const now = options.now?.() ?? new Date();
  const rescuePath = (await exists(resolvedDatabasePath))
    ? `${resolvedDatabasePath}.pre-rollback-${backupTimestamp(now)}.sqlite`
    : undefined;
  if (rescuePath !== undefined) {
    const current = new DatabaseSync(resolvedDatabasePath);
    try {
      await sqliteBackup(current, rescuePath);
    } finally {
      current.close();
    }
  }

  const temporaryPath = `${resolvedDatabasePath}.${process.pid}.${randomUUID()}.restore.tmp`;
  try {
    const source = new DatabaseSync(verification.backupPath, { readOnly: true });
    try {
      await sqliteBackup(source, temporaryPath);
    } finally {
      source.close();
    }
    await rm(`${resolvedDatabasePath}-wal`, { force: true });
    await rm(`${resolvedDatabasePath}-shm`, { force: true });
    await rm(resolvedDatabasePath, { force: true });
    await rename(temporaryPath, resolvedDatabasePath);
    const restored = new DatabaseSync(resolvedDatabasePath, { readOnly: true });
    try {
      const integrity = restored.prepare('PRAGMA integrity_check').get() as
        Record<string, unknown> | undefined;
      if (integrity?.integrity_check !== 'ok') throw new Error('Restored database is corrupt');
      const restoredSchemaVersion = readSchemaVersion(restored);
      if (restoredSchemaVersion !== manifest.sourceSchemaVersion) {
        throw new Error('Restored database schema does not match the backup manifest');
      }
      return {
        restoredSchemaVersion,
        ...(rescuePath === undefined ? {} : { rescuePath }),
      };
    } finally {
      restored.close();
    }
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    if (rescuePath !== undefined && (await exists(rescuePath))) {
      const rescue = new DatabaseSync(rescuePath, { readOnly: true });
      try {
        await sqliteBackup(rescue, resolvedDatabasePath);
      } finally {
        rescue.close();
      }
    }
    throw error;
  }
}

function parseManifest(value: string): DatabaseBackupManifest {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('Backup manifest must be an object');
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.formatVersion !== 1 ||
    typeof record.createdAt !== 'string' ||
    typeof record.sourceDatabasePath !== 'string' ||
    typeof record.backupFile !== 'string' ||
    !Number.isSafeInteger(record.sourceSchemaVersion) ||
    !Number.isSafeInteger(record.targetSchemaVersion) ||
    !Number.isSafeInteger(record.byteLength) ||
    typeof record.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.sha256)
  ) {
    throw new TypeError('Backup manifest is invalid');
  }
  return record as unknown as DatabaseBackupManifest;
}

function readSchemaVersion(database: DatabaseSync): number {
  const row = database.prepare('PRAGMA user_version').get() as
    Record<string, number | bigint> | undefined;
  const value = row?.user_version ?? 0;
  return typeof value === 'bigint' ? Number(value) : value;
}

function backupTimestamp(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new RangeError('Backup timestamp must be valid');
  return value.toISOString().replace(/[-:.]/g, '');
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function failure(
  error: Extract<DatabaseBackupVerification, { ok: false }>['error'],
  cause: unknown,
): Extract<DatabaseBackupVerification, { ok: false }> {
  return {
    ok: false,
    error,
    message: cause instanceof Error ? cause.message : String(cause),
  };
}
