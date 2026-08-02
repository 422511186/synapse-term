import { closeSync, openSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const [userDataDirectory, sshTarget, outputPath] = process.argv.slice(2);
if (userDataDirectory === undefined || sshTarget === undefined || outputPath === undefined) {
  throw new Error('user data directory, SSH target, and output path are required');
}

const workspace = resolve(import.meta.dirname, '..');
const require = createRequire(new URL('../package.json', import.meta.url));
const playwrightCli = require.resolve('@playwright/test/cli');
const output = openSync(resolve(outputPath), 'w');

try {
  const child = spawn(
    process.execPath,
    [
      playwrightCli,
      'test',
      'apps/desktop/e2e/real-environment.spec.ts',
      '--config=playwright.electron.config.ts',
      '--reporter=list',
    ],
    {
      cwd: workspace,
      env: {
        ...process.env,
        TERMINAL_AGENT_REAL_E2E: '1',
        TERMINAL_AGENT_SSH_TARGET: sshTarget,
        TERMINAL_AGENT_REAL_USER_DATA_DIR: resolve(userDataDirectory),
      },
      stdio: ['ignore', output, output],
      windowsHide: true,
    },
  );
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit(code ?? (signal === null ? 1 : 128)));
  });
  process.exitCode = exitCode;
} finally {
  closeSync(output);
}
