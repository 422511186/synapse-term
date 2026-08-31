import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface GeneralSettings {
  hideCompletionProbeEcho: boolean;
}

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = Object.freeze({
  hideCompletionProbeEcho: true,
});

export interface GeneralSettingsStore {
  load(): Promise<GeneralSettings>;
  save(settings: GeneralSettings): Promise<void>;
  readonly path: string;
}

export function sanitizeGeneralSettings(value: unknown): GeneralSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return structuredClone(DEFAULT_GENERAL_SETTINGS);
  }
  const record = value as Record<string, unknown>;
  return {
    hideCompletionProbeEcho:
      typeof record.hideCompletionProbeEcho === 'boolean'
        ? record.hideCompletionProbeEcho
        : DEFAULT_GENERAL_SETTINGS.hideCompletionProbeEcho,
  };
}

export function createGeneralSettingsStore(directory: string): GeneralSettingsStore {
  const path = join(directory, 'general.json');
  return {
    path,
    async load() {
      try {
        return sanitizeGeneralSettings(JSON.parse(await readFile(path, 'utf8')) as unknown);
      } catch {
        return structuredClone(DEFAULT_GENERAL_SETTINGS);
      }
    },
    async save(settings) {
      await mkdir(directory, { recursive: true });
      const temporaryPath = `${path}.tmp`;
      await writeFile(
        temporaryPath,
        `${JSON.stringify(sanitizeGeneralSettings(settings), null, 2)}\n`,
        'utf8',
      );
      await rename(temporaryPath, path);
    },
  };
}
