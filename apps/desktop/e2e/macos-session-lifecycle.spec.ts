import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { _electron as electron, expect, test, type Page } from '@playwright/test';

test.describe('macOS real Electron session lifecycle', () => {
  test.skip(process.platform !== 'darwin', 'This lifecycle smoke test requires macOS shells.');

  test('uses the real preload and Core for a local terminal Session', async () => {
    test.setTimeout(180_000);
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'terminal-agent-macos-e2e-'));
    const desktopDirectory = resolve(import.meta.dirname, '..');
    const title = `macos lifecycle ${process.pid}`;
    const application = await electron.launch({
      args: [
        '--disable-gpu',
        '--no-sandbox',
        `--user-data-dir=${userDataDirectory}`,
        desktopDirectory,
      ],
      env: {
        ...process.env,
        TERMINAL_AGENT_APP_ID: `terminal-agent-macos-e2e-${basename(userDataDirectory)}`,
        TERMINAL_AGENT_USER_DATA_DIR: userDataDirectory,
      },
      timeout: 30_000,
    });
    let page: Page | undefined;
    let sessionId: string | undefined;

    try {
      page = await application.firstWindow({ timeout: 30_000 });
      await expect
        .poll(() => page!.evaluate(() => window.terminalAgent?.core.status()), { timeout: 30_000 })
        .toMatchObject({ connected: true });

      const environment = await page.evaluate(async () => {
        if (window.terminalAgent === undefined)
          throw new Error('Electron preload API is unavailable');
        return window.terminalAgent.sessions.environment();
      });
      const shell = environment.shells.find(
        (candidate) => candidate.available && candidate.executionDialect === 'posix',
      );
      expect(shell).toBeDefined();
      if (shell === undefined || shell.executable === undefined) return;

      const session = await page.evaluate(
        async ({ launch, sessionTitle }) => {
          if (window.terminalAgent === undefined)
            throw new Error('Electron preload API is unavailable');
          return window.terminalAgent.sessions.create({
            title: sessionTitle,
            terminalType: launch.label,
            executable: launch.executable,
            args: launch.args,
            cwd: launch.cwd,
            env: {},
            executionDialect: launch.executionDialect,
          });
        },
        {
          sessionTitle: title,
          launch: {
            args: shell.args,
            cwd: environment.home,
            executable: shell.executable,
            executionDialect: shell.executionDialect,
            label: shell.label,
          },
        },
      );
      sessionId = session.id;

      await expect(
        page.getByRole('tab', { name: `${title} ${shell.label}`, exact: true }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.getByLabel(`${title} 终端`)).toBeVisible({ timeout: 20_000 });

      await page.evaluate(
        async ({ activeSessionId, marker }) => {
          if (window.terminalAgent === undefined)
            throw new Error('Electron preload API is unavailable');
          await window.terminalAgent.terminal.write(activeSessionId, `printf '${marker}\\n'\r`);
        },
        { activeSessionId: sessionId, marker: '__TA_MACOS_LIFECYCLE_READY__' },
      );
      await expect
        .poll(() => terminalReplay(page!, sessionId!), { timeout: 30_000 })
        .toContain('__TA_MACOS_LIFECYCLE_READY__');

      const resourceRefresh = await page.evaluate(async (activeSessionId) => {
        if (window.terminalAgent === undefined)
          throw new Error('Electron preload API is unavailable');
        return window.terminalAgent.resources.refresh(activeSessionId);
      }, sessionId);
      if (!resourceRefresh.ok) {
        const diagnostics = await page.evaluate(async (activeSessionId) => {
          if (window.terminalAgent === undefined) return undefined;
          const [sessions, replay] = await Promise.all([
            window.terminalAgent.sessions.list(),
            window.terminalAgent.terminal.replay(activeSessionId, 0),
          ]);
          const output = `${replay.snapshot ?? ''}${replay.events
            .map((event) => event.data)
            .join('')}`;
          return {
            session: sessions.find((item) => item.id === activeSessionId),
            outputTail: output.slice(-12_000),
          };
        }, sessionId);
        throw new Error(
          `Resource refresh failed: ${resourceRefresh.error.code}: ${resourceRefresh.error.message}\n${JSON.stringify(diagnostics)}`,
        );
      }
      await expect
        .poll(
          () =>
            page!.evaluate(async (activeSessionId) => {
              if (window.terminalAgent === undefined)
                throw new Error('Electron preload API is unavailable');
              return window.terminalAgent.resources.get(activeSessionId);
            }, sessionId!),
          { timeout: 30_000 },
        )
        .toMatchObject({ dialect: 'posix' });

      const closed = await page.evaluate(async (activeSessionId) => {
        if (window.terminalAgent === undefined)
          throw new Error('Electron preload API is unavailable');
        return window.terminalAgent.sessions.close(activeSessionId);
      }, sessionId);
      expect(closed).toBe(true);
      await expect
        .poll(
          () =>
            page!.evaluate(async (activeSessionId) => {
              if (window.terminalAgent === undefined)
                throw new Error('Electron preload API is unavailable');
              return (await window.terminalAgent.sessions.list()).some(
                (item) => item.id === activeSessionId,
              );
            }, sessionId!),
          { timeout: 20_000 },
        )
        .toBe(false);
      sessionId = undefined;
    } finally {
      if (page !== undefined && sessionId !== undefined) {
        await page
          .evaluate(async (activeSessionId) => {
            await window.terminalAgent?.sessions.close(activeSessionId).catch(() => undefined);
          }, sessionId)
          .catch(() => undefined);
      }
      await page
        ?.evaluate(async () => {
          await window.terminalAgent?.core.exit('terminate_sessions').catch(() => undefined);
        })
        .catch(() => undefined);
      await application.close().catch(() => undefined);
      await rm(userDataDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});

async function terminalReplay(page: Page, sessionId: string): Promise<string> {
  return page.evaluate(async (activeSessionId) => {
    if (window.terminalAgent === undefined) throw new Error('Electron preload API is unavailable');
    const replay = await window.terminalAgent.terminal.replay(activeSessionId, 0);
    return `${replay.snapshot ?? ''}${replay.events.map((event) => event.data).join('')}`;
  }, sessionId);
}
