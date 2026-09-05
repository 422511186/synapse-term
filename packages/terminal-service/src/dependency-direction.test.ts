import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

async function collectImplementationFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectImplementationFiles(path)));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(path);
  }
  return files;
}

describe('terminal-service dependency direction', () => {
  it('does not depend on runtime packages, Desktop, or package internals', async () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const files = await collectImplementationFiles(root);
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      expect(source, file).not.toMatch(/apps[\\/]desktop/);
      expect(source, file).not.toMatch(/@synapse-term\/(session-runtime|mcp-runtime)/);
      expect(source, file).not.toMatch(/@synapse-term\/[^'"\s]+\/src[\\/]/);
    }
  });
});
