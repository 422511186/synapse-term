/**
 * 首次启动时把旧品牌（terminal-agent）的数据目录迁移到当前 userData 目录。
 * 只复制不删除旧目录；目标目录已有真实数据时跳过，避免覆盖。
 */
import { cpSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const USER_DATA_MIGRATION_MARKER = 'user-data-migration.json';

export interface MigrateLegacyUserDataOptions {
  legacyUserDataDirectory: string;
  targetUserDataDirectory: string;
}

export type MigrateLegacyUserDataResult =
  | { status: 'skipped'; reason: 'no-legacy-data' | 'already-migrated' | 'target-has-data' }
  | { status: 'migrated'; directories: string[] };

/** 这些表里有行才视为用户真实数据；sessions/audit_events 可能包含自动产生的记录，不算。 */
const USER_DATA_TABLES = [
  'agent_tasks',
  'agent_conversations',
  'agent_turns',
  'model_configurations',
  'provider_profiles',
  'tool_calls',
  'approval_grants',
  'command_transactions',
] as const;

function targetDatabaseHasUserData(sqlitePath: string): boolean {
  try {
    const database = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
      for (const table of USER_DATA_TABLES) {
        try {
          const row = database.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as
            { n: number } | undefined;
          if (row !== undefined && row.n > 0) return true;
        } catch {
          // 旧 schema 没有该表，忽略
        }
      }
      return false;
    } finally {
      database.close();
    }
  } catch {
    // 读不了（损坏或非 SQLite 文件）时保守跳过，避免覆盖未知数据
    return true;
  }
}

function backupTargetDatabase(coreDirectory: string): void {
  const sqlitePath = join(coreDirectory, 'core.sqlite');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${sqlitePath}${suffix}`;
    if (existsSync(source)) {
      renameSync(source, `${sqlitePath}.pre-migration-${timestamp}${suffix}`);
    }
  }
}

export function migrateLegacyUserData(
  options: MigrateLegacyUserDataOptions,
): MigrateLegacyUserDataResult {
  const { legacyUserDataDirectory, targetUserDataDirectory } = options;
  const legacyCoreDirectory = join(legacyUserDataDirectory, 'core');
  if (!existsSync(join(legacyCoreDirectory, 'core.sqlite'))) {
    return { status: 'skipped', reason: 'no-legacy-data' };
  }

  const markerPath = join(targetUserDataDirectory, USER_DATA_MIGRATION_MARKER);
  if (existsSync(markerPath)) {
    return { status: 'skipped', reason: 'already-migrated' };
  }

  const targetCoreDirectory = join(targetUserDataDirectory, 'core');
  const targetSqlitePath = join(targetCoreDirectory, 'core.sqlite');
  if (existsSync(targetSqlitePath)) {
    if (targetDatabaseHasUserData(targetSqlitePath)) {
      return { status: 'skipped', reason: 'target-has-data' };
    }
    backupTargetDatabase(targetCoreDirectory);
  }

  const directories: string[] = [];
  cpSync(legacyCoreDirectory, targetCoreDirectory, { recursive: true, force: true });
  directories.push('core');
  for (const name of ['mcp', 'acp']) {
    const source = join(legacyUserDataDirectory, name);
    if (existsSync(source)) {
      cpSync(source, join(targetUserDataDirectory, name), { recursive: true, force: true });
      directories.push(name);
    }
  }

  mkdirSync(targetUserDataDirectory, { recursive: true });
  writeFileSync(
    markerPath,
    JSON.stringify(
      {
        migratedAt: new Date().toISOString(),
        source: legacyUserDataDirectory,
        target: targetUserDataDirectory,
        directories,
      },
      null,
      2,
    ),
  );
  return { status: 'migrated', directories };
}
