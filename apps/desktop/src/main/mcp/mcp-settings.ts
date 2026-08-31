import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type McpApprovalMode = 'read_only' | 'managed' | 'full';

export const DEFAULT_MCP_PORT = 4_739;

export function normalizeMcpApprovalMode(value: unknown): McpApprovalMode {
  return value === 'managed' || value === 'full' ? value : 'read_only';
}

export interface McpSettings {
  enabled: boolean;
  approvalMode: McpApprovalMode;
  token?: string | undefined;
  port: number;
}

export interface McpSettingsStore {
  load(): Promise<McpSettings>;
  save(settings: McpSettings): Promise<void>;
  readonly path: string;
}

const DEFAULT_SETTINGS: McpSettings = Object.freeze({
  enabled: false,
  approvalMode: 'read_only',
  port: DEFAULT_MCP_PORT,
});

export function generateMcpToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sanitizeMcpSettings(value: unknown): McpSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return structuredClone(DEFAULT_SETTINGS);
  }
  const record = value as Record<string, unknown>;
  if (
    record.approvalMode !== 'read_only' &&
    record.approvalMode !== 'managed' &&
    record.approvalMode !== 'full'
  ) {
    return structuredClone(DEFAULT_SETTINGS);
  }
  const token =
    typeof record.token === 'string' && record.token.length > 0 ? record.token : undefined;
  const port =
    typeof record.port === 'number' &&
    Number.isInteger(record.port) &&
    record.port >= 1 &&
    record.port <= 65_535
      ? record.port
      : DEFAULT_MCP_PORT;
  return {
    enabled: record.enabled === true,
    approvalMode: normalizeMcpApprovalMode(record.approvalMode),
    ...(token === undefined ? {} : { token }),
    port,
  };
}

export function createMcpSettingsStore(directory: string): McpSettingsStore {
  const path = join(directory, 'settings.json');
  return {
    path,
    async load() {
      try {
        return sanitizeMcpSettings(JSON.parse(await readFile(path, 'utf8')) as unknown);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return structuredClone(DEFAULT_SETTINGS);
        }
        return structuredClone(DEFAULT_SETTINGS);
      }
    },
    async save(settings) {
      await mkdir(directory, { recursive: true });
      const temporaryPath = `${path}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
      await rename(temporaryPath, path);
    },
  };
}
