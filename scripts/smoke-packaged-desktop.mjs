/* global window */
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { _electron as electron } from '@playwright/test';

const appPath = process.argv[2];
if (appPath === undefined) {
  throw new Error('usage: node scripts/smoke-packaged-desktop.mjs <path-to-packaged-app>');
}

const userDataDirectory = await mkdtemp(join(tmpdir(), `synapse-term-smoke-${basename(appPath)}-`));
const application = await electron.launch({
  executablePath: resolve(appPath),
  args: ['--no-sandbox', `--user-data-dir=${userDataDirectory}`],
  env: {
    ...process.env,
    SYNAPSE_TERM_USER_DATA_DIR: userDataDirectory,
  },
  timeout: 30_000,
});

try {
  const page = await application.firstWindow({ timeout: 30_000 });
  await page.waitForSelector('.prototype-shell', { timeout: 20_000 });

  const environment = await page.evaluate(async () => {
    if (window.terminalAgent === undefined) throw new Error('preload API is unavailable');
    return window.terminalAgent.sessions.environment();
  });
  const shell = environment.shells.find(
    (candidate) => candidate.available && candidate.executable !== undefined,
  );
  if (shell?.executable === undefined) throw new Error('no local shell is available');
  const home = homedir();

  const session = await page.evaluate(
    async ({ args, cwd, executable, title }) => {
      if (window.terminalAgent === undefined) throw new Error('preload API is unavailable');
      return window.terminalAgent.sessions.create({
        title,
        terminalType: 'Smoke',
        executable,
        args,
        cwd,
        env: {},
      });
    },
    {
      args: shell.args,
      cwd: home,
      executable: shell.executable,
      title: `smoke ${Date.now()}`,
    },
  );
  if (session.pty !== 'running') {
    throw new Error(`packaged session is not running: ${session.pty}`);
  }

  const status = await page.evaluate(async () => {
    if (window.terminalAgent === undefined) throw new Error('preload API is unavailable');
    return window.terminalAgent.core.status();
  });
  console.log(
    JSON.stringify({
      ok: true,
      sessionId: session.id,
      sessions: status.sessions,
    }),
  );
} finally {
  await application.close().catch(() => undefined);
  await rm(userDataDirectory, { recursive: true, force: true }).catch(() => undefined);
}
