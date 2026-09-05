import type { SessionLaunchInput, SessionRuntime } from '@synapse-term/session-runtime';

export class SessionIpcAdapter {
  readonly #runtime: SessionRuntime;

  constructor(runtime: SessionRuntime) {
    this.#runtime = runtime;
  }

  async handle(channel: string, args: readonly unknown[]): Promise<unknown> {
    switch (channel) {
      case 'sessions:list':
        return this.#runtime.listSessions();
      case 'sessions:environment':
        return this.#runtime.environment();
      case 'sessions:create':
        return this.#runtime.createSession(parseLaunchInput(args[0]));
      case 'sessions:rename':
        return this.#runtime.renameSession(idArg(args[0]), boundedString(args[1], 128, 'alias'));
      case 'sessions:close':
        return this.#runtime.closeSession(idArg(args[0]));
      case 'terminal:write':
        return this.#runtime.write(idArg(args[0]), boundedString(args[1], 1_000_000, 'data'));
      case 'terminal:resize':
        return this.#runtime.resize(idArg(args[0]), dimensionArg(args[1]), dimensionArg(args[2]));
      case 'app:status':
        return this.#runtime.status();
      default:
        throw new Error(`Renderer channel is not available: ${channel}`);
    }
  }
}

function parseLaunchInput(value: unknown): SessionLaunchInput {
  if (typeof value !== 'object' || value === null) throw new TypeError('expected launch input');
  const input = value as Record<string, unknown>;
  return {
    title: boundedString(input.title, 128, 'title'),
    terminalType: boundedString(input.terminalType, 128, 'terminalType'),
    executable: boundedString(input.executable, 4_096, 'executable'),
    args: stringArrayArg(input.args),
    cwd: boundedString(input.cwd, 4_096, 'cwd'),
    env: recordArg(input.env),
    ...(input.columns === undefined ? {} : { columns: dimensionArg(input.columns) }),
    ...(input.rows === undefined ? {} : { rows: dimensionArg(input.rows) }),
  };
}

function idArg(value: unknown): string {
  return boundedString(value, 256, 'sessionId');
}

function boundedString(value: unknown, maxLength: number, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function numberArg(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('expected a number argument');
  }
  return value;
}

function stringArrayArg(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 256 ||
    value.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 1_024)
  ) {
    throw new TypeError('expected a string array argument');
  }
  return [...value] as string[];
}

function recordArg(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === 'string' && entry[0].length > 0 && entry[0].length <= 256,
  );
  if (entries.length > 64 || entries.some(([, entryValue]) => entryValue.length > 4_096)) {
    throw new TypeError('environment is invalid');
  }
  return Object.fromEntries(entries);
}

function dimensionArg(value: unknown): number {
  const parsed = numberArg(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000) {
    throw new RangeError('terminal dimension must be between 1 and 1000');
  }
  return parsed;
}
