import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';

import { withTemporaryDirectory } from '@terminal-agent/test-kit';

import { NodeCoreProcessLauncher } from './core-process.js';

describe('NodeCoreProcessLauncher', () => {
  it('starts and stops an independent Node Core process', async () => {
    const launcher = new NodeCoreProcessLauncher({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 60_000)'],
      gracefulStopTimeoutMs: 0,
    });

    await launcher.start();
    expect(launcher.pid).toEqual(expect.any(Number));
    await launcher.stop();
    expect(launcher.pid).toBeUndefined();
  });

  it('does not reuse a child that was externally terminated before exit was observed', async () => {
    const launcher = new NodeCoreProcessLauncher({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 60_000)'],
      gracefulStopTimeoutMs: 0,
    });

    await launcher.start();
    const firstPid = launcher.pid;
    if (firstPid === undefined) throw new Error('Core child did not start');
    process.kill(firstPid, 'SIGKILL');

    await launcher.start();
    expect(launcher.pid).toEqual(expect.any(Number));
    expect(launcher.pid).not.toBe(firstPid);
    await launcher.stop();
  });

  it('allows a Core that is already shutting down to exit before forcing termination', async () => {
    await withTemporaryDirectory(async (directory) => {
      const readyPath = join(directory, 'ready.txt');
      const markerPath = join(directory, 'graceful.txt');
      const launcher = new NodeCoreProcessLauncher({
        command: process.execPath,
        args: [
          '-e',
          `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(
            readyPath,
          )}, 'ready'); setTimeout(() => { fs.writeFileSync(${JSON.stringify(
            markerPath,
          )}, 'closed'); process.exit(0); }, 75)`,
        ],
        gracefulStopTimeoutMs: 1_000,
      });

      await launcher.start();
      await waitForFile(readyPath, 'ready');
      await launcher.stop();

      await expect(readFile(markerPath, 'utf8')).resolves.toBe('closed');
      expect(launcher.pid).toBeUndefined();
    });
  });
});

async function waitForFile(path: string, expected: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const value = await readFile(path, 'utf8').catch(() => undefined);
    if (value === expected) return;
    await delay(10);
  }
  throw new Error(`Timed out waiting for child process marker: ${path}`);
}
