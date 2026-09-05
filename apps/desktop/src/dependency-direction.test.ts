import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectSourceFiles(path)));
    else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.tsx')
    ) {
      files.push(path);
    }
  }
  return files;
}

describe('Desktop dependency direction', () => {
  it('keeps Renderer and preload behind their public seams', async () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const files = await collectSourceFiles(root);
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      expect(source, file).not.toMatch(
        /@synapse-term\/(domain|terminal-service|session-runtime|mcp-runtime)\/src[\\/]/,
      );
      if (/[/\\]renderer[/\\]|[/\\]preload[/\\]/.test(file)) {
        expect(source, file).not.toMatch(/[/\\]main[/\\]/);
      }
    }
  });
});
