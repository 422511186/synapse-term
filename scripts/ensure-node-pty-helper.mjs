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

  const candidates = [
    resolve(
      workspace,
      'node_modules/node-pty/prebuilds',
      `${platform}-${architecture}`,
      'spawn-helper',
    ),
    resolve(
      workspace,
      'apps/desktop/node_modules/node-pty/prebuilds',
      `${platform}-${architecture}`,
      'spawn-helper',
    ),
  ];
  for (const helper of candidates) {
    try {
      await chmod(helper, 0o755);
      return;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  await ensureNodePtySpawnHelperExecutable();
}
