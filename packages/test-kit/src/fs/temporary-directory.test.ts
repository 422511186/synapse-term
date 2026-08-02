import { access, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { withTemporaryDirectory } from './temporary-directory.js';

describe('temporary data directory', () => {
  it('cleans the directory after the callback completes', async () => {
    let directory = '';
    const result = await withTemporaryDirectory(async (path) => {
      directory = path;
      await writeFile(`${path}/state.json`, '{"ok":true}', 'utf8');
      return 'done';
    });

    expect(result).toBe('done');
    await expect(access(directory)).rejects.toThrow();
  });
});
