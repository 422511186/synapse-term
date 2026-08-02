import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { withTemporaryDirectory } from '@terminal-agent/test-kit';

import { CoreAlreadyRunningError, CoreLockCorruptError, FileStartupLock } from './startup-lock.js';

describe('FileStartupLock', () => {
  it('allows only one live owner and releases cleanly', async () => {
    await withTemporaryDirectory(async (directory) => {
      const lockPath = join(directory, 'core.lock');
      const first = new FileStartupLock(lockPath, {
        pid: process.pid,
        instanceId: 'core-1',
        startedAt: '2026-07-27T15:00:00.000Z',
      });
      const second = new FileStartupLock(lockPath, {
        pid: process.pid,
        instanceId: 'core-2',
        startedAt: '2026-07-27T15:00:01.000Z',
      });

      await first.acquire();
      await expect(second.acquire()).rejects.toBeInstanceOf(CoreAlreadyRunningError);
      await first.release();
      await expect(second.acquire()).resolves.toBeUndefined();
      await second.release();
    });
  });

  it('reclaims a dead owner but fails closed on corrupt metadata', async () => {
    await withTemporaryDirectory(async (directory) => {
      const stalePath = join(directory, 'stale.lock');
      await writeFile(
        stalePath,
        JSON.stringify({
          pid: Number.MAX_SAFE_INTEGER,
          instanceId: 'core-stale',
          startedAt: '2026-07-27T15:00:00.000Z',
        }),
      );
      const stale = new FileStartupLock(stalePath, {
        pid: process.pid,
        instanceId: 'core-new',
        startedAt: '2026-07-27T15:00:01.000Z',
      });
      await stale.acquire();
      await stale.release();

      const corruptPath = join(directory, 'corrupt.lock');
      await writeFile(corruptPath, 'not-json');
      const lock = new FileStartupLock(corruptPath, {
        pid: process.pid,
        instanceId: 'core-new',
        startedAt: '2026-07-27T15:00:01.000Z',
      });

      await expect(lock.acquire()).rejects.toBeInstanceOf(CoreLockCorruptError);
    });
  });
});
