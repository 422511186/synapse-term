import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export interface UpgradeActivityState {
  running: boolean;
  sessions: number;
  agentTasks: number;
}

export interface UpgradeStateFileOptions {
  pid: number;
  instanceId: string;
  version: string;
  now?: () => Date;
  replaceFile?: (source: string, destination: string) => Promise<void>;
}

export class UpgradeStateFile {
  readonly #path: string;
  readonly #pid: number;
  readonly #instanceId: string;
  readonly #version: string;
  readonly #now: () => Date;
  readonly #replaceFile: (source: string, destination: string) => Promise<void>;
  #pending: Promise<void> = Promise.resolve();

  constructor(path: string, options: UpgradeStateFileOptions) {
    if (!Number.isSafeInteger(options.pid) || options.pid < 1) {
      throw new RangeError('pid must be a positive integer');
    }
    assertIniValue(options.instanceId, 'instanceId');
    assertIniValue(options.version, 'version');
    this.#path = path;
    this.#pid = options.pid;
    this.#instanceId = options.instanceId;
    this.#version = options.version;
    this.#now = options.now ?? (() => new Date());
    this.#replaceFile = options.replaceFile ?? rename;
  }

  async update(state: UpgradeActivityState): Promise<void> {
    assertActivity(state);
    const operation = this.#pending.catch(() => undefined).then(() => this.#write(state));
    this.#pending = operation;
    await operation;
  }

  markStopped(): Promise<void> {
    return this.update({ running: false, sessions: 0, agentTasks: 0 });
  }

  async flush(): Promise<void> {
    await this.#pending;
  }

  async #write(state: UpgradeActivityState): Promise<void> {
    const updatedAt = this.#now();
    if (Number.isNaN(updatedAt.getTime())) throw new RangeError('updatedAt must be valid');
    const value = [
      '[core]',
      'formatVersion=1',
      `running=${state.running ? '1' : '0'}`,
      `sessions=${String(state.sessions)}`,
      `agentTasks=${String(state.agentTasks)}`,
      `pid=${String(this.#pid)}`,
      `instanceId=${this.#instanceId}`,
      `version=${this.#version}`,
      `updatedAt=${updatedAt.toISOString()}`,
      '',
    ].join('\n');
    await mkdir(dirname(this.#path), { recursive: true });
    const temporaryPath = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, value, 'utf8');
      await replaceWithRetry(this.#replaceFile, temporaryPath, this.#path);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

async function replaceWithRetry(
  replaceFile: (source: string, destination: string) => Promise<void>,
  source: string,
  destination: string,
): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await replaceFile(source, destination);
      return;
    } catch (error) {
      if (!isTransientReplacementError(error) || attempt === 5) throw error;
      await delay(10 * 2 ** attempt);
    }
  }
}

function isTransientReplacementError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false;
  return ['EACCES', 'EBUSY', 'EPERM'].includes(String(error.code));
}

function assertActivity(state: UpgradeActivityState): void {
  if (
    !Number.isSafeInteger(state.sessions) ||
    state.sessions < 0 ||
    !Number.isSafeInteger(state.agentTasks) ||
    state.agentTasks < 0
  ) {
    throw new RangeError('Core activity counts must be non-negative integers');
  }
}

function assertIniValue(value: string, name: string): void {
  if (value.length === 0 || /[\r\n=]/.test(value)) {
    throw new RangeError(`${name} must be a non-empty single-line INI value`);
  }
}
