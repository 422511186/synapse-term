import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createDatabaseBackup } from '@synapse-term/infrastructure';

const workspace = resolve(import.meta.dirname, '..');
const runtime = resolve(
  process.env.TERMINAL_AGENT_RUNTIME_DIR ?? resolve(workspace, '.packaging/core-runtime'),
);
const nodeBinary = process.platform === 'win32' ? 'node.exe' : 'node';
const node = join(runtime, nodeBinary);
const maintenance = join(runtime, 'dist', 'core-maintenance.mjs');

void main();

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'terminal-agent-maintenance-smoke-'));
  try {
    const databasePath = join(directory, 'core.sqlite');
    const database = new DatabaseSync(databasePath);
    database.exec(
      'CREATE TABLE entries (id TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version = 1',
    );
    database.prepare('INSERT INTO entries VALUES (?, ?)').run('one', 'rollback-proof');
    const backup = await createDatabaseBackup(database, {
      databasePath,
      backupDirectory: join(directory, 'backups'),
      sourceSchemaVersion: 1,
      targetSchemaVersion: 2,
    });
    database.exec('ALTER TABLE entries ADD COLUMN note TEXT; PRAGMA user_version = 2');
    database.close();
    await writeFile(
      join(directory, 'upgrade-state.ini'),
      `[core]\nrunning=0\npid=${String(process.pid)}\n`,
      'utf8',
    );

    const verification = await run(node, [maintenance, 'verify-backup', backup.manifestPath]);
    const restore = await run(node, [
      maintenance,
      'restore-backup',
      backup.manifestPath,
      databasePath,
    ]);
    const restored = new DatabaseSync(databasePath, { readOnly: true });
    const version = Number(
      (restored.prepare('PRAGMA user_version').get() as Record<string, number | bigint>)
        .user_version,
    );
    const row = restored.prepare('SELECT * FROM entries').get();
    restored.close();
    if (version !== 1 || (row as { value?: string } | undefined)?.value !== 'rollback-proof') {
      throw new Error('Packaged maintenance CLI did not restore the v1 database');
    }
    console.log(JSON.stringify({ verification, restore, restoredSchemaVersion: version }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function run(command: string, args: readonly string[]): Promise<unknown> {
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolvePromise, reject) => {
      const child = spawn(command, [...args], { windowsHide: true });
      let stdout = '';
      let stderr = '';
      child.stdout?.setEncoding('utf8').on('data', (value: string) => {
        stdout += value;
      });
      child.stderr?.setEncoding('utf8').on('data', (value: string) => {
        stderr += value;
      });
      child.once('error', reject);
      child.once('exit', (code) => resolvePromise({ code, stdout, stderr }));
    },
  );
  if (result.code !== 0) {
    throw new Error(`Maintenance command failed (${String(result.code)}): ${result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout.trim()) as unknown;
}
