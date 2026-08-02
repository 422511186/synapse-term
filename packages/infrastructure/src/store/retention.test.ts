import { mkdir, utimes, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { withTemporaryDirectory } from '@synapse-term/test-kit';

import { CORE_MIGRATIONS } from './core-schema.js';
import { CoreRepositories } from './repositories.js';
import { RetentionManager } from './retention.js';
import { SqliteStore } from './sqlite-store.js';

describe('RetentionManager', () => {
  it('cleans raw logs and old audit events using configurable cutoffs', async () => {
    await withTemporaryDirectory(async (directory) => {
      const rawDirectory = join(directory, 'raw');
      await mkdir(rawDirectory);
      const oldRaw = join(rawDirectory, 'old.log');
      const freshRaw = join(rawDirectory, 'fresh.log');
      await writeFile(oldRaw, 'old');
      await writeFile(freshRaw, 'fresh');
      const now = Date.parse('2026-07-27T15:00:00.000Z');
      await utimes(oldRaw, new Date(now - 10_000), new Date(now - 10_000));
      await utimes(freshRaw, new Date(now), new Date(now));

      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const repositories = new CoreRepositories(store);
      repositories.appendAuditEvent({
        id: 'old-audit',
        actor: { kind: 'system' },
        type: 'test',
        occurredAt: '2026-07-01T00:00:00.000Z',
        payload: {},
      });
      repositories.appendAuditEvent({
        id: 'fresh-audit',
        actor: { kind: 'system' },
        type: 'test',
        occurredAt: '2026-07-27T14:59:59.000Z',
        payload: {},
      });
      const retention = new RetentionManager(rawDirectory, repositories, {
        rawRetentionMs: 5_000,
        auditRetentionMs: 60_000,
      });

      await expect(retention.cleanup(now)).resolves.toEqual({ rawLogs: 1, auditEvents: 1 });
      await expect(stat(oldRaw)).rejects.toThrow();
      await expect(stat(freshRaw)).resolves.toBeDefined();
      expect(repositories.listAuditEvents().map((event) => event.id)).toEqual(['fresh-audit']);
      await store.close();
    });
  });
});
