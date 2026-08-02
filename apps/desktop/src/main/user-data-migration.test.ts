/**
 * 首次启动时的旧数据迁移测试：terminal-agent 数据目录 → synapse-term 数据目录。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { withTemporaryDirectory } from '@synapse-term/test-kit';

import { migrateLegacyUserData, USER_DATA_MIGRATION_MARKER } from './user-data-migration.js';

function createLegacyData(directory: string): void {
  const coreDirectory = join(directory, 'core');
  mkdirSync(coreDirectory, { recursive: true });
  writeFileSync(join(coreDirectory, 'core.sqlite'), 'legacy-db-bytes');
  writeFileSync(join(coreDirectory, 'auth.token'), 'legacy-token');
  writeFileSync(join(coreDirectory, 'upgrade-state.ini'), '[core]\nformatVersion=1');
  mkdirSync(join(coreDirectory, 'raw-logs'), { recursive: true });
  writeFileSync(join(coreDirectory, 'raw-logs', 'legacy.log'), 'legacy-log');
}

function createEmptyTargetDatabase(sqlitePath: string): void {
  const database = new DatabaseSync(sqlitePath);
  database.exec(`
    CREATE TABLE agent_tasks (id TEXT PRIMARY KEY);
    CREATE TABLE sessions (id TEXT PRIMARY KEY);
    INSERT INTO sessions (id) VALUES ('stale-session');
  `);
  database.close();
}

function createTargetDatabaseWithAgentData(sqlitePath: string): void {
  const database = new DatabaseSync(sqlitePath);
  database.exec(`
    CREATE TABLE agent_tasks (id TEXT PRIMARY KEY);
    INSERT INTO agent_tasks (id) VALUES ('real-task');
  `);
  database.close();
}

describe('migrateLegacyUserData', () => {
  it('skips when the legacy data directory does not exist', async () => {
    await withTemporaryDirectory(async (directory) => {
      const target = join(directory, 'target');

      const result = migrateLegacyUserData({
        legacyUserDataDirectory: join(directory, 'missing'),
        targetUserDataDirectory: target,
      });

      expect(result).toEqual({ status: 'skipped', reason: 'no-legacy-data' });
      expect(existsSync(join(target, USER_DATA_MIGRATION_MARKER))).toBe(false);
    });
  });

  it('skips when migration was already performed', async () => {
    await withTemporaryDirectory(async (directory) => {
      const legacy = join(directory, 'legacy');
      const target = join(directory, 'target');
      createLegacyData(legacy);
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, USER_DATA_MIGRATION_MARKER), '{}');

      const result = migrateLegacyUserData({
        legacyUserDataDirectory: legacy,
        targetUserDataDirectory: target,
      });

      expect(result).toEqual({ status: 'skipped', reason: 'already-migrated' });
      expect(existsSync(join(target, 'core'))).toBe(false);
    });
  });

  it('skips when the target database already holds agent data', async () => {
    await withTemporaryDirectory(async (directory) => {
      const legacy = join(directory, 'legacy');
      const target = join(directory, 'target');
      createLegacyData(legacy);
      mkdirSync(join(target, 'core'), { recursive: true });
      createTargetDatabaseWithAgentData(join(target, 'core', 'core.sqlite'));

      const result = migrateLegacyUserData({
        legacyUserDataDirectory: legacy,
        targetUserDataDirectory: target,
      });

      expect(result).toEqual({ status: 'skipped', reason: 'target-has-data' });
      expect(readFileSync(join(target, 'core', 'core.sqlite')).toString()).toContain('real-task');
    });
  });

  it('copies the legacy core directory and writes a migration marker', async () => {
    await withTemporaryDirectory(async (directory) => {
      const legacy = join(directory, 'legacy');
      const target = join(directory, 'target');
      createLegacyData(legacy);

      const result = migrateLegacyUserData({
        legacyUserDataDirectory: legacy,
        targetUserDataDirectory: target,
      });

      expect(result.status).toBe('migrated');
      const targetCore = join(target, 'core');
      expect(readFileSync(join(targetCore, 'core.sqlite')).toString()).toBe('legacy-db-bytes');
      expect(readFileSync(join(targetCore, 'auth.token')).toString()).toBe('legacy-token');
      expect(readFileSync(join(targetCore, 'upgrade-state.ini')).toString()).toContain(
        'formatVersion=1',
      );
      expect(readFileSync(join(targetCore, 'raw-logs', 'legacy.log')).toString()).toBe(
        'legacy-log',
      );
      const marker = JSON.parse(readFileSync(join(target, USER_DATA_MIGRATION_MARKER), 'utf8')) as {
        source: string;
        target: string;
        directories: string[];
      };
      expect(marker.source).toBe(legacy);
      expect(marker.target).toBe(target);
      expect(marker.directories).toContain('core');
    });
  });

  it('replaces an empty target database after backing it up', async () => {
    await withTemporaryDirectory(async (directory) => {
      const legacy = join(directory, 'legacy');
      const target = join(directory, 'target');
      createLegacyData(legacy);
      mkdirSync(join(target, 'core'), { recursive: true });
      createEmptyTargetDatabase(join(target, 'core', 'core.sqlite'));

      const result = migrateLegacyUserData({
        legacyUserDataDirectory: legacy,
        targetUserDataDirectory: target,
      });

      expect(result.status).toBe('migrated');
      expect(readFileSync(join(target, 'core', 'core.sqlite')).toString()).toBe('legacy-db-bytes');
      const backup = readdirSync(join(target, 'core')).find((name) =>
        name.startsWith('core.sqlite.pre-migration-'),
      );
      expect(backup).toBeDefined();
    });
  });

  it('migrates mcp and acp settings directories when present', async () => {
    await withTemporaryDirectory(async (directory) => {
      const legacy = join(directory, 'legacy');
      const target = join(directory, 'target');
      createLegacyData(legacy);
      mkdirSync(join(legacy, 'mcp'), { recursive: true });
      writeFileSync(join(legacy, 'mcp', 'settings.json'), '{"mcp":true}');
      mkdirSync(join(legacy, 'acp'), { recursive: true });
      writeFileSync(join(legacy, 'acp', 'settings.json'), '{"acp":true}');

      const result = migrateLegacyUserData({
        legacyUserDataDirectory: legacy,
        targetUserDataDirectory: target,
      });

      expect(result.status).toBe('migrated');
      expect(readFileSync(join(target, 'mcp', 'settings.json')).toString()).toBe('{"mcp":true}');
      expect(readFileSync(join(target, 'acp', 'settings.json')).toString()).toBe('{"acp":true}');
    });
  });
});
