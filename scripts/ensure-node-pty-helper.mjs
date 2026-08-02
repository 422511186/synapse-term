import { chmod } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspace = resolve(dirname(scriptPath), '..');

export async function ensureNodePtySpawnHelperExecutable({
  workspace = defaultWorkspace,
  platform = process.platform,
  architecture = process.arch,
} = {}) {
  if (platform !== 'darwin') return;

  const helper = resolve(
    workspace,
    'apps/core/node_modules/node-pty/prebuilds',
    `${platform}-${architecture}`,
    'spawn-helper',
  );
  await chmod(helper, 0o755);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  await ensureNodePtySpawnHelperExecutable();
}
