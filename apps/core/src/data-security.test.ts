import { mkdir, rm, stat, writeFile, utimes } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { userInfo } from 'node:os';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { withTemporaryDirectory } from '@terminal-agent/test-kit';

import {
  cleanupExpiredRawLogs,
  ensureCoreDataLayout,
  FileAuthTokenStore,
} from './data-security.js';

describe('Core data security', () => {
  it('creates private data layout and keeps the auth token outside SQLite', async () => {
    await withTemporaryDirectory(async (directory) => {
      let aclCalls = 0;
      const layout = await ensureCoreDataLayout(join(directory, 'app-data'), {
        applyAcl: async () => {
          aclCalls += 1;
        },
      });
      expect(aclCalls).toBeGreaterThan(0);
      await expect(stat(layout.rawLogDirectory)).resolves.toBeDefined();
      await expect(stat(layout.auditDirectory)).resolves.toBeDefined();

      const tokens = new FileAuthTokenStore(layout.authTokenPath, { applyAcl: async () => {} });
      await tokens.save('secret-token');
      await expect(tokens.load()).resolves.toBe('secret-token');
      await tokens.clear();
      await expect(tokens.load()).resolves.toBeUndefined();
    });
  });

  it.skipIf(process.platform !== 'win32')(
    'keeps a token file readable by the current user after applying its ACL',
    async () => {
      await withTemporaryDirectory(async (directory) => {
        const layout = await ensureCoreDataLayout(join(directory, 'secured'));
        const tokens = new FileAuthTokenStore(layout.authTokenPath);
        try {
          await tokens.save('secret-token');
          await expect(tokens.load()).resolves.toBe('secret-token');
          await tokens.clear();
        } finally {
          await promisify(execFile)(
            'icacls.exe',
            [layout.authTokenPath, '/grant:r', `${userInfo().username}:F`],
            { windowsHide: true },
          ).catch(() => undefined);
          await rm(layout.authTokenPath, { force: true }).catch(() => undefined);
        }
      });
    },
  );

  it('removes only raw log files older than the cutoff', async () => {
    await withTemporaryDirectory(async (directory) => {
      const rawLogs = join(directory, 'raw');
      await mkdir(rawLogs);
      const oldFile = join(rawLogs, 'old.log');
      const newFile = join(rawLogs, 'new.log');
      await writeFile(oldFile, 'old');
      await writeFile(newFile, 'new');
      const now = Date.now();
      await utimes(oldFile, new Date(now - 10_000), new Date(now - 10_000));
      await utimes(newFile, new Date(now), new Date(now));

      expect(await cleanupExpiredRawLogs(rawLogs, now - 5_000)).toBe(1);
      await expect(stat(oldFile)).rejects.toThrow();
      await expect(stat(newFile)).resolves.toBeDefined();
    });
  });
});
