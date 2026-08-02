import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

test.describe('macOS real Electron runtime failures', () => {
  test.skip(process.platform !== 'darwin', 'This failure smoke test requires macOS Electron.');

  test('shows a real Core startup error instead of a browser mock success state', async () => {
    test.setTimeout(60_000);
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'terminal-agent-macos-failure-'));
    const desktopDirectory = resolve(import.meta.dirname, '..');
    const application = await electron.launch({
      args: [
        '--disable-gpu',
        '--no-sandbox',
        `--user-data-dir=${userDataDirectory}`,
        desktopDirectory,
      ],
      env: {
        ...process.env,
        TERMINAL_AGENT_APP_ID: `terminal-agent-macos-failure-${basename(userDataDirectory)}`,
        TERMINAL_AGENT_CORE_NODE: join(userDataDirectory, 'missing-core-node'),
        TERMINAL_AGENT_USER_DATA_DIR: userDataDirectory,
      },
      timeout: 30_000,
    });

    try {
      const page = await application.firstWindow({ timeout: 30_000 });
      await expect(page.getByRole('alert')).toContainText(/spawn|ENOENT|Core/i, {
        timeout: 20_000,
      });
      await expect(page.getByText('暂无终端会话', { exact: true })).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => ({
            hasRealPreloadApi: window.terminalAgent !== undefined,
            platform: window.terminalAgent?.platform,
          })),
        )
        .toEqual({ hasRealPreloadApi: true, platform: 'darwin' });
    } finally {
      await application.close().catch(() => undefined);
      await rm(userDataDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
