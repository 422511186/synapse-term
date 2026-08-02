import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';

export interface CoreMainOptions {
  dataDirectory: string;
  appId: string;
  username: string;
  instanceId: string;
  version: string;
  idleExitDelayMs: number;
}

export function parseCoreMainOptions(
  environment: Readonly<Record<string, string | undefined>>,
): CoreMainOptions {
  const dataDirectory = required(environment.TERMINAL_AGENT_DATA_DIR, 'TERMINAL_AGENT_DATA_DIR');
  return {
    dataDirectory,
    appId: environment.TERMINAL_AGENT_APP_ID?.trim() || 'terminal-agent',
    username: environment.TERMINAL_AGENT_USERNAME?.trim() || userInfo().username,
    instanceId: environment.TERMINAL_AGENT_INSTANCE_ID?.trim() || randomUUID(),
    version: environment.TERMINAL_AGENT_VERSION?.trim() || '0.0.0-dev',
    idleExitDelayMs: nonNegativeInteger(
      environment.TERMINAL_AGENT_IDLE_EXIT_MS,
      'TERMINAL_AGENT_IDLE_EXIT_MS',
      60_000,
    ),
  };
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function nonNegativeInteger(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined || value.trim().length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}
