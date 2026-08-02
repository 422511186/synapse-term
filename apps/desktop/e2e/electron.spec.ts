import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { _electron as electron, expect, test, type Page } from '@playwright/test';

test.describe('real Electron desktop', () => {
  test.skip(process.platform !== 'win32', 'The MVP desktop runtime is Windows-first.');

  test('creates a ConPTY session, streams output, and restores it after renderer reload', async () => {
    test.setTimeout(180_000);
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'terminal-agent-e2e-'));
    const desktopDirectory = resolve(import.meta.dirname, '..');
    const applicationId = `terminal-agent-e2e-${basename(userDataDirectory)}`;
    const application = await electron.launch({
      args: [
        '--disable-gpu',
        '--no-sandbox',
        `--user-data-dir=${userDataDirectory}`,
        desktopDirectory,
      ],
      env: {
        ...process.env,
        TERMINAL_AGENT_USER_DATA_DIR: userDataDirectory,
        TERMINAL_AGENT_APP_ID: applicationId,
        USERPROFILE: userDataDirectory,
      },
      timeout: 30_000,
    });
    let page: Page | undefined;

    try {
      page = await application.firstWindow({ timeout: 30_000 });
      await expect(page.getByText('Terminal Agent', { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText('Core 已连接', { exact: true })).toBeVisible({
        timeout: 20_000,
      });

      await page.getByRole('button', { name: '当前 Session：无活动 Session' }).click();
      await page.getByRole('button', { name: '新建 Session' }).click();
      await page.getByLabel('名称').fill('e2e powershell');
      await expect(page.getByLabel('工作目录')).toHaveCount(0);
      await page.getByLabel('Shell').selectOption('powershell');
      await page.getByRole('button', { name: '创建会话' }).click();

      const terminal = page.getByLabel('e2e powershell 终端');
      await expect(terminal.locator('.xterm-screen')).toBeVisible({ timeout: 20_000 });
      await writeTerminalCommand(
        page,
        'e2e powershell',
        "Write-Output ('TERMINAL_AGENT_E2E_' + 'READY')",
      );
      await expect(terminal).toContainText('TERMINAL_AGENT_E2E_READY', { timeout: 20_000 });
      await refreshResourcesUntilReady(page);
      await page.waitForTimeout(2_000);
      await writeTerminalCommand(
        page,
        'e2e powershell',
        "Clear-Host; Write-Output ('TERMINAL_AGENT_AFTER_' + 'RESOURCE')",
      );
      await expect(terminal).toContainText('TERMINAL_AGENT_AFTER_RESOURCE', { timeout: 20_000 });
      await page.waitForTimeout(500);

      const evidenceDirectory = resolve(import.meta.dirname, '../../../docs/evidence');
      await mkdir(evidenceDirectory, { recursive: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await assertNoDocumentOverflow(page);
      await page.screenshot({
        path: join(evidenceDirectory, 'desktop-1440x900.png'),
        fullPage: true,
      });

      await page.setViewportSize({ width: 980, height: 640 });
      await page.getByTitle('关闭 Agent 面板').click({ timeout: 5_000 });
      await expect(page.locator('.agent-panel')).toHaveCount(0);
      const workspaceBounds = await page.locator('.workspace').boundingBox();
      const terminalBounds = await page.locator('.terminal-column').boundingBox();
      expect(workspaceBounds).not.toBeNull();
      expect(terminalBounds).not.toBeNull();
      expect(
        Math.abs(
          terminalBounds!.x + terminalBounds!.width - (workspaceBounds!.x + workspaceBounds!.width),
        ),
      ).toBeLessThanOrEqual(1);
      await expect(terminal).toContainText('TERMINAL_AGENT_AFTER_RESOURCE');
      await assertNoDocumentOverflow(page);
      await page.screenshot({
        path: join(evidenceDirectory, 'minimum-980x640.png'),
        fullPage: true,
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(terminal).toBeVisible();
      await expect(page.locator('.session-rail')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: '当前 Session：e2e powershell' }),
      ).toBeVisible();
      await assertNoDocumentOverflow(page);
      await page.screenshot({
        path: join(evidenceDirectory, 'mobile-390x844.png'),
        fullPage: true,
      });

      await page.reload();
      await expect(page.getByText('e2e powershell', { exact: true }).first()).toBeVisible();
      await expect(page.getByLabel('e2e powershell 终端').locator('.xterm-screen')).toBeVisible({
        timeout: 20_000,
      });
      expect(await readTerminalReplay(page, 'e2e powershell')).toContain(
        'TERMINAL_AGENT_AFTER_RESOURCE',
      );

      await page.getByRole('button', { name: '当前 Session：e2e powershell' }).click();
      await page.getByRole('button', { name: '关闭 e2e powershell' }).click();
      await expect(page.getByText('当前没有终端会话', { exact: true })).toBeVisible();
    } finally {
      await page
        ?.evaluate(async () => {
          const api = (
            globalThis as typeof globalThis & {
              terminalAgent?: { core: { exit(mode: string): Promise<void> } };
            }
          ).terminalAgent;
          await api?.core.exit('terminate_sessions');
        })
        .catch(() => undefined);
      await application.close().catch(() => undefined);
      if (userDataDirectory.startsWith(tmpdir())) {
        await rm(userDataDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  });
});

async function writeTerminalCommand(page: Page, title: string, command: string): Promise<void> {
  await page.evaluate(
    async ({ title: sessionTitle, command: terminalCommand }) => {
      const api = (
        globalThis as typeof globalThis & {
          terminalAgent: {
            sessions: { list(): Promise<Array<{ id: string; title: string }>> };
            terminal: { write(sessionId: string, data: string): Promise<void> };
          };
        }
      ).terminalAgent;
      const session = (await api.sessions.list()).find(
        (candidate) => candidate.title === sessionTitle,
      );
      if (session === undefined) throw new Error('未找到 E2E 终端会话');
      await api.terminal.write(session.id, `${terminalCommand}\r`);
    },
    { title, command },
  );
}

async function refreshResourcesUntilReady(page: Page): Promise<void> {
  await page.getByRole('button', { name: '资源监控' }).click();
  const panel = page.getByRole('dialog', { name: 'Session 资源' });
  const refresh = panel.getByRole('button', { name: '刷新资源' });
  for (let attempt = 0; attempt < 1; attempt += 1) {
    await refresh.click();
    await expect(refresh).toBeEnabled({ timeout: 75_000 });
    if (/刚刚更新|部分不可用/.test(await panel.innerText())) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`资源刷新未成功：${await panel.innerText()}`);
}

async function readTerminalReplay(page: Page, title: string): Promise<string> {
  return page.evaluate(async (sessionTitle) => {
    const api = (
      globalThis as typeof globalThis & {
        terminalAgent: {
          sessions: { list(): Promise<Array<{ id: string; title: string }>> };
          terminal: {
            replay(
              sessionId: string,
              afterSequence: number,
            ): Promise<{ snapshot?: string; events: Array<{ data: string }> }>;
          };
        };
      }
    ).terminalAgent;
    const session = (await api.sessions.list()).find(
      (candidate) => candidate.title === sessionTitle,
    );
    if (session === undefined) throw new Error('未找到 E2E 终端会话');
    const replay = await api.terminal.replay(session.id, 0);
    return `${replay.snapshot ?? ''}${replay.events.map((event) => event.data).join('')}`;
  }, title);
}

async function assertNoDocumentOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
  expect(metrics.scrollWidth).toBe(metrics.clientWidth);
  expect(metrics.scrollHeight).toBe(metrics.clientHeight);
}
