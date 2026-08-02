import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export async function withTemporaryDirectory<T>(
  callback: (path: string) => T | Promise<T>,
): Promise<T> {
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'terminal-agent-'));
  if (
    resolve(dirname(directory)).toLowerCase() !== temporaryRoot.toLowerCase() ||
    !basename(directory).startsWith('terminal-agent-')
  ) {
    throw new Error('temporary directory escaped the operating-system temp root');
  }

  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
}
