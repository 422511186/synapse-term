import { closeSync, openSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const [dataDirectory, modelConfigurationId, outputPath] = process.argv.slice(2);
if (dataDirectory === undefined || modelConfigurationId === undefined || outputPath === undefined) {
  throw new Error('data directory, model configuration id, and output path are required');
}

const workspace = resolve(import.meta.dirname, '..');
const require = createRequire(new URL('../package.json', import.meta.url));
const tsxCli = require.resolve('tsx/cli');
const verificationScript = resolve(workspace, 'scripts/verify-real-agent.mts');
const output = openSync(resolve(outputPath), 'w');

try {
  const child = spawn(process.execPath, [tsxCli, verificationScript], {
    cwd: workspace,
    env: {
      ...process.env,
      TERMINAL_AGENT_DATA_DIR: resolve(dataDirectory),
      TERMINAL_AGENT_MODEL_CONFIGURATION_ID: modelConfigurationId,
    },
    stdio: ['ignore', output, output],
    windowsHide: true,
  });
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit(code ?? (signal === null ? 1 : 128)));
  });
  process.exitCode = exitCode;
} finally {
  closeSync(output);
}
