import { describe, expect, it, vi } from 'vitest';
import process from 'node:process';

import type { NativePtyModule, NativePtyProcess, NativePtySpawnOptions } from './pty-adapter.js';
import { NodePtySpawner } from './pty-adapter.js';

function createFakeNative(): { module: NativePtyModule; process: NativePtyProcess } {
  const nativeProcess: NativePtyProcess = {
    pid: 42,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: () => ({ dispose: vi.fn() }),
    onExit: () => ({ dispose: vi.fn() }),
  };
  const module: NativePtyModule = {
    spawn: vi.fn(() => nativeProcess),
  };
  return { module, process: nativeProcess };
}

describe('NodePtySpawner', () => {
  it('spawns with validated options and wraps the native process', async () => {
    const { module, process: nativeProcess } = createFakeNative();
    const spawner = new NodePtySpawner(module, { forceKillProcessTree: vi.fn() });
    const backend = spawner.spawn({
      executable: '/bin/zsh',
      args: ['-l', '-i'],
      cwd: '/home/test',
      env: { TERM: 'xterm-256color' },
      columns: 80,
      rows: 24,
    });
    expect(module.spawn).toHaveBeenCalledWith(
      '/bin/zsh',
      ['-l', '-i'],
      expect.objectContaining({
        cols: 80,
        rows: 24,
        name: 'xterm-256color',
        useConpty: process.platform === 'win32',
      }) satisfies NativePtySpawnOptions,
    );
    expect(backend.pid).toBe(42);
    backend.write('x');
    expect(nativeProcess.write).toHaveBeenCalledWith('x');
    backend.resize(100, 40);
    expect(nativeProcess.resize).toHaveBeenCalledWith(100, 40);
    backend.interrupt();
    expect(nativeProcess.write).toHaveBeenCalledWith('\x03');
  });
});
