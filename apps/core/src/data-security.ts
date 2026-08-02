import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { userInfo } from 'node:os';

const execFileAsync = promisify(execFile);

export interface CoreDataLayout {
  root: string;
  databasePath: string;
  upgradeStatePath: string;
  rawLogDirectory: string;
  auditDirectory: string;
  authTokenPath: string;
}

export interface DataSecurityOptions {
  applyAcl?: (path: string) => Promise<void>;
}

async function applyCurrentUserAcl(path: string): Promise<void> {
  await chmod(path, 0o700);
  if (process.platform === 'win32') {
    const directory = (await stat(path)).isDirectory();
    await execFileAsync(
      'icacls.exe',
      [
        path,
        '/inheritance:r',
        '/grant:r',
        directory ? `${userInfo().username}:(OI)(CI)F` : `${userInfo().username}:F`,
      ],
      { windowsHide: true, timeout: 5_000 },
    );
  }
}

export async function ensureCoreDataLayout(
  root: string,
  options: DataSecurityOptions = {},
): Promise<CoreDataLayout> {
  const resolvedRoot = resolve(root);
  const applyAcl = options.applyAcl ?? applyCurrentUserAcl;
  const rawLogDirectory = join(resolvedRoot, 'raw-logs');
  const auditDirectory = join(resolvedRoot, 'audit');
  await mkdir(rawLogDirectory, { recursive: true });
  await mkdir(auditDirectory, { recursive: true });
  await applyAcl(resolvedRoot);
  await applyAcl(rawLogDirectory);
  await applyAcl(auditDirectory);

  return {
    root: resolvedRoot,
    databasePath: join(resolvedRoot, 'core.sqlite'),
    upgradeStatePath: join(resolvedRoot, 'upgrade-state.ini'),
    rawLogDirectory,
    auditDirectory,
    authTokenPath: join(resolvedRoot, 'auth.token'),
  };
}

export interface AuthTokenStoreOptions {
  applyAcl?: (path: string) => Promise<void>;
}

export class FileAuthTokenStore {
  readonly #path: string;
  readonly #applyAcl: (path: string) => Promise<void>;

  constructor(path: string, options: AuthTokenStoreOptions = {}) {
    this.#path = path;
    this.#applyAcl = options.applyAcl ?? applyCurrentUserAcl;
  }

  async save(token: string): Promise<void> {
    if (token.length === 0) throw new RangeError('auth token must not be empty');
    await mkdir(dirname(this.#path), { recursive: true });
    const temporaryPath = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, token, { encoding: 'utf8', mode: 0o600 });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.#path);
      await this.#applyAcl(this.#path);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async load(): Promise<string | undefined> {
    try {
      const token = await readFile(this.#path, 'utf8');
      return token.length === 0 ? undefined : token;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async clear(): Promise<void> {
    await rm(this.#path, { force: true });
  }
}

export async function cleanupExpiredRawLogs(
  directory: string,
  cutoffTimeMs: number,
): Promise<number> {
  const resolvedDirectory = resolve(directory);
  const entries = await readdir(resolvedDirectory, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(resolvedDirectory, entry.name);
    const metadata = await stat(path);
    if (metadata.mtimeMs < cutoffTimeMs) {
      await rm(path, { force: true });
      removed += 1;
    }
  }
  return removed;
}
