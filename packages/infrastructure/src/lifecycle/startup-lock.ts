import { open, mkdir, readFile, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface StartupLockMetadata {
  pid: number;
  instanceId: string;
  startedAt: string;
}

export class CoreAlreadyRunningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoreAlreadyRunningError';
  }
}

export class CoreLockCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoreLockCorruptError';
  }
}

export class FileStartupLock {
  readonly #lockPath: string;
  readonly #metadata: StartupLockMetadata;
  #handle: FileHandle | undefined;

  constructor(lockPath: string, metadata: StartupLockMetadata) {
    this.#lockPath = lockPath;
    this.#metadata = metadata;
  }

  async acquire(): Promise<void> {
    if (this.#handle !== undefined) return;
    await mkdir(dirname(this.#lockPath), { recursive: true });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await open(this.#lockPath, 'wx');
        await handle.writeFile(JSON.stringify(this.#metadata), 'utf8');
        await handle.sync();
        this.#handle = handle;
        return;
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
          throw error;
        }

        const existing = await this.#readExistingMetadata();
        if (existing !== undefined && this.#isProcessAlive(existing.pid)) {
          throw new CoreAlreadyRunningError(
            `Core instance ${existing.instanceId} is already running`,
          );
        }

        await unlink(this.#lockPath).catch((unlinkError: unknown) => {
          if (
            !(unlinkError instanceof Error) ||
            !('code' in unlinkError) ||
            unlinkError.code !== 'ENOENT'
          ) {
            throw unlinkError;
          }
        });
      }
    }

    throw new CoreAlreadyRunningError('Core startup lock could not be acquired');
  }

  async release(): Promise<void> {
    const handle = this.#handle;
    this.#handle = undefined;
    if (handle === undefined) return;
    await handle.close();
    await unlink(this.#lockPath).catch((error: unknown) => {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
        throw error;
      }
    });
  }

  async #readExistingMetadata(): Promise<StartupLockMetadata | undefined> {
    try {
      const raw = await readFile(this.#lockPath, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new CoreLockCorruptError('Core startup lock contains invalid JSON');
      }
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof (parsed as { pid?: unknown }).pid !== 'number' ||
        typeof (parsed as { instanceId?: unknown }).instanceId !== 'string' ||
        typeof (parsed as { startedAt?: unknown }).startedAt !== 'string'
      ) {
        throw new CoreLockCorruptError('Core startup lock metadata is invalid');
      }
      return parsed as StartupLockMetadata;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  #isProcessAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error instanceof Error && 'code' in error && error.code === 'EPERM';
    }
  }
}
