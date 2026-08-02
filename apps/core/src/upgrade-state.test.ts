import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { withTemporaryDirectory } from '@terminal-agent/test-kit';

import { UpgradeStateFile } from './upgrade-state.js';

describe('UpgradeStateFile', () => {
  it('atomically publishes active Core state and marks a stopped Core', async () => {
    await withTemporaryDirectory(async (directory) => {
      const path = join(directory, 'upgrade-state.ini');
      const state = new UpgradeStateFile(path, {
        pid: 4242,
        instanceId: 'core-instance-1',
        version: '0.2.0',
        now: () => new Date('2026-07-28T03:00:00.000Z'),
      });

      await state.update({ running: true, sessions: 2, agentTasks: 1 });
      await expect(readFile(path, 'utf8')).resolves.toBe(
        [
          '[core]',
          'formatVersion=1',
          'running=1',
          'sessions=2',
          'agentTasks=1',
          'pid=4242',
          'instanceId=core-instance-1',
          'version=0.2.0',
          'updatedAt=2026-07-28T03:00:00.000Z',
          '',
        ].join('\n'),
      );

      await state.markStopped();
      const stopped = await readFile(path, 'utf8');
      expect(stopped).toContain('running=0');
      expect(stopped).toContain('sessions=0');
      expect(stopped).toContain('agentTasks=0');
    });
  });

  it('rejects invalid activity counts and line-breaking metadata', async () => {
    await withTemporaryDirectory(async (directory) => {
      expect(
        () =>
          new UpgradeStateFile(join(directory, 'upgrade-state.ini'), {
            pid: 1,
            instanceId: 'unsafe\nvalue',
            version: '0.1.0',
          }),
      ).toThrow('instanceId');

      const state = new UpgradeStateFile(join(directory, 'upgrade-state.ini'), {
        pid: 1,
        instanceId: 'safe',
        version: '0.1.0',
      });
      await expect(state.update({ running: true, sessions: -1, agentTasks: 0 })).rejects.toThrow(
        'non-negative integers',
      );
    });
  });

  it('retries transient Windows replacement failures before publishing state', async () => {
    await withTemporaryDirectory(async (directory) => {
      const path = join(directory, 'upgrade-state.ini');
      let attempts = 0;
      const state = new UpgradeStateFile(path, {
        pid: 4242,
        instanceId: 'core-instance-retry',
        version: '0.2.0',
        replaceFile: async (source, destination) => {
          attempts += 1;
          if (attempts < 3) {
            throw Object.assign(new Error('file is temporarily locked'), { code: 'EPERM' });
          }
          await rename(source, destination);
        },
      });

      await state.update({ running: true, sessions: 1, agentTasks: 0 });

      expect(attempts).toBe(3);
      await expect(readFile(path, 'utf8')).resolves.toContain('sessions=1');
    });
  });
});
