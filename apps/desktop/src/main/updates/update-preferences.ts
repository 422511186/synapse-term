import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function updatePreferences(directory: string) {
  const path = join(directory, 'updates.json');
  return {
    async load(): Promise<boolean> {
      try {
        const value: unknown = JSON.parse(await readFile(path, 'utf8'));
        if (
          value &&
          typeof value === 'object' &&
          'automaticChecks' in value &&
          typeof value.automaticChecks === 'boolean'
        ) {
          return value.automaticChecks;
        }
      } catch {
        /* Missing or damaged preferences use the default. */
      }
      return true;
    },
    async save(enabled: boolean): Promise<void> {
      await mkdir(directory, { recursive: true });
      await writeFile(`${path}.tmp`, `${JSON.stringify({ automaticChecks: enabled })}\n`, 'utf8');
      await rename(`${path}.tmp`, path);
    },
  };
}
