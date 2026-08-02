import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const workspace = resolve(import.meta.dirname, '../../..');
const scriptPath = join(workspace, 'scripts/ensure-node-pty-helper.mjs');
const temporaryDirectories: string[] = [];

interface HelperModule {
  ensureNodePtySpawnHelperExecutable(options: {
    workspace: string;
    platform: string;
    architecture: string;
  }): Promise<void>;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('node-pty macOS installation', () => {
  it('runs the spawn-helper permission repair after dependency installation', async () => {
    const packageJson = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.postinstall).toBe('node scripts/ensure-node-pty-helper.mjs');
  });

  it('restores the executable bits on the installed Darwin spawn-helper', async () => {
    const helperModule = (await import(pathToFileURL(scriptPath).href).catch(() => undefined)) as
      HelperModule | undefined;
    expect(helperModule).toBeDefined();
    if (helperModule === undefined) return;

    const testWorkspace = await mkdtemp(join(tmpdir(), 'terminal-agent-node-pty-'));
    temporaryDirectories.push(testWorkspace);
    const helper = join(
      testWorkspace,
      'apps/core/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
    );
    await mkdir(dirname(helper), { recursive: true });
    await writeFile(helper, 'helper');
    await chmod(helper, 0o644);

    await helperModule.ensureNodePtySpawnHelperExecutable({
      workspace: testWorkspace,
      platform: 'darwin',
      architecture: 'arm64',
    });

    expect((await stat(helper)).mode & 0o111).toBe(0o111);
  });
});
