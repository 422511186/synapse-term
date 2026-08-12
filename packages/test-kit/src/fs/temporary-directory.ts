import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export async function withTemporaryDirectory<T>(
  callback: (path: string) => T | Promise<T>,
): Promise<T> {
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'terminal-agent-'));
  if (
    resolve(dirname(directory)).toLowerCase() !== temporaryRoot.toLowerCase() ||
    !basename(directory).startsWith('terminal-agent-')
  ) {
    throw new Error('temporary directory escaped the operating-system temp root');
  }

  try {
    return await callback(directory);
  } finally {
    await removeTemporaryDirectory(directory);
  }
}

/**
 * 清理临时目录（best-effort）。
 * Windows 上 SQLite 的 WAL 模式会在目录下产生 -wal/-shm 边车文件，database.close()
 * 后这些句柄的释放存在延迟，立即 rm 偶发 EBUSY（resource busy or locked）。
 * 临时目录清理失败本身不影响测试断言的正确性（OS 会在重启或定期清理 temp 时回收），
 * 故对 EBUSY 降级为静默忽略；其余真实错误（如权限拒绝）仍向上抛出，避免掩盖真问题。
 */
async function removeTemporaryDirectory(directory: string): Promise<void> {
  try {
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      (error as NodeJS.ErrnoException).code === 'EBUSY'
    ) {
      return;
    }
    throw error;
  }
}
