import { access, mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';

import { createDatabaseBackup, type DatabaseBackupArtifact } from './database-backup.js';

export { restoreDatabaseBackup, verifyDatabaseBackup } from './database-backup.js';

export class UnsupportedSchemaVersionError extends Error {
  readonly databaseVersion: number;
  readonly supportedVersion: number;

  constructor(databaseVersion: number, supportedVersion: number) {
    super(
      `Database schema version ${String(databaseVersion)} is newer than supported version ${String(
        supportedVersion,
      )}`,
    );
    this.name = 'UnsupportedSchemaVersionError';
    this.databaseVersion = databaseVersion;
    this.supportedVersion = supportedVersion;
  }
}

export interface SqliteMigration {
  version: number;
  migrate(database: DatabaseSync): void;
}

export interface SqliteStoreOptions {
  backupDirectory?: string;
  now?: () => Date;
}

export class SqliteStore {
  readonly #databasePath: string;
  readonly #migrations: readonly SqliteMigration[];
  readonly #backupDirectory: string;
  readonly #now: () => Date;
  #database: DatabaseSync | undefined;
  #schemaVersion = 0;
  #backup: DatabaseBackupArtifact | undefined;

  constructor(
    databasePath: string,
    migrations: readonly SqliteMigration[],
    options: SqliteStoreOptions = {},
  ) {
    this.#databasePath = databasePath;
    this.#migrations = [...migrations].sort((left, right) => left.version - right.version);
    this.#backupDirectory = options.backupDirectory ?? join(dirname(databasePath), 'backups');
    this.#now = options.now ?? (() => new Date());
    if (
      this.#migrations.some(
        (migration, index) =>
          !Number.isInteger(migration.version) ||
          migration.version < 1 ||
          (index > 0 && migration.version <= this.#migrations[index - 1]!.version),
      )
    ) {
      throw new RangeError('SQLite migration versions must be increasing positive integers');
    }
  }

  get schemaVersion(): number {
    return this.#schemaVersion;
  }

  get backupPath(): string | undefined {
    return this.#backup?.backupPath;
  }

  get backupManifestPath(): string | undefined {
    return this.#backup?.manifestPath;
  }

  async open(): Promise<void> {
    if (this.#database !== undefined) return;
    await mkdir(dirname(this.#databasePath), { recursive: true });
    const databaseExists = await this.#exists(this.#databasePath);

    const database = new DatabaseSync(this.#databasePath);
    try {
      database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      this.#schemaVersion = this.#readSchemaVersion(database);
      const supportedVersion = this.#migrations.at(-1)?.version ?? 0;
      if (this.#schemaVersion > supportedVersion) {
        throw new UnsupportedSchemaVersionError(this.#schemaVersion, supportedVersion);
      }
      if (databaseExists && this.#schemaVersion < supportedVersion) {
        this.#backup = await createDatabaseBackup(database, {
          databasePath: this.#databasePath,
          backupDirectory: this.#backupDirectory,
          sourceSchemaVersion: this.#schemaVersion,
          targetSchemaVersion: supportedVersion,
          now: this.#now,
        });
      }
      for (const migration of this.#migrations) {
        if (migration.version <= this.#schemaVersion) continue;
        database.exec('BEGIN IMMEDIATE');
        try {
          migration.migrate(database);
          database.exec(`PRAGMA user_version = ${String(migration.version)}`);
          database.exec('COMMIT');
          this.#schemaVersion = migration.version;
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      }
      this.#database = database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  pragma(name: string): unknown {
    const database = this.#requireDatabase();
    if (!/^[A-Za-z_]+$/.test(name)) throw new RangeError('invalid SQLite pragma name');
    const row = database.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
    return row?.[name];
  }

  transaction<T>(callback: (database: DatabaseSync) => T): T {
    const database = this.#requireDatabase();
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = callback(database);
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  database(): DatabaseSync {
    return this.#requireDatabase();
  }

  async close(): Promise<void> {
    const database = this.#database;
    this.#database = undefined;
    if (database === undefined) return;
    try {
      database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      database.close();
    }
  }

  #requireDatabase(): DatabaseSync {
    if (this.#database === undefined) throw new Error('SQLite store is not open');
    return this.#database;
  }

  #readSchemaVersion(database: DatabaseSync): number {
    const row = database.prepare('PRAGMA user_version').get() as
      Record<string, number | bigint> | undefined;
    const value = row?.user_version ?? 0;
    return typeof value === 'bigint' ? Number(value) : value;
  }

  async #exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}
