import { describe, expect, it } from 'vitest';

import { NodePtySpawner, type NativePtyModule, type NativePtyProcess } from './pty-adapter.js';

class FakeNativePty implements NativePtyProcess {
  pid = 123;
  writes: string[] = [];
  resizes: Array<{ columns: number; rows: number }> = [];
  killCalls = 0;
  #dataListener: ((data: string) => void) | undefined;
  #exitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined;

  write(data: string): void {
    this.writes.push(data);
  }

  resize(columns: number, rows: number): void {
    this.resizes.push({ columns, rows });
  }

  kill(): void {
    this.killCalls += 1;
  }

  onData(listener: (data: string) => void) {
    this.#dataListener = listener;
    return { dispose: () => (this.#dataListener = undefined) };
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
    this.#exitListener = listener;
    return { dispose: () => (this.#exitListener = undefined) };
  }

  emitData(data: string): void {
    this.#dataListener?.(data);
  }

  emitExit(event: { exitCode: number; signal?: number }): void {
    this.#exitListener?.(event);
  }
}

describe('NodePtySpawner', () => {
  it('maps spawn, IO, resize, Ctrl+C, terminate, data, and exit', () => {
    const native = new FakeNativePty();
    const spawnCalls: unknown[] = [];
    const module: NativePtyModule = {
      spawn: (file, args, options) => {
        spawnCalls.push({ file, args, options });
        return native;
      },
    };
    const pty = new NodePtySpawner(module).spawn({
      executable: 'C:/Program Files/Git/bin/bash.exe',
      args: ['--login'],
      cwd: 'C:/work',
      env: { TERM: 'xterm-256color' },
      columns: 120,
      rows: 40,
    });
    const data: string[] = [];
    const exits: Array<{ exitCode: number; signal?: number | undefined }> = [];
    pty.onData((chunk) => data.push(chunk));
    pty.onExit((event) => exits.push(event));

    pty.write('echo test\r');
    pty.resize(100, 30);
    pty.interrupt();
    native.emitData('test\r\n');
    native.emitExit({ exitCode: 0 });
    pty.terminate();

    expect(spawnCalls).toEqual([
      {
        file: 'C:/Program Files/Git/bin/bash.exe',
        args: ['--login'],
        options: {
          cwd: 'C:/work',
          env: { TERM: 'xterm-256color' },
          cols: 120,
          rows: 40,
          name: 'xterm-256color',
          useConpty: process.platform === 'win32',
        },
      },
    ]);
    expect(native.writes).toEqual(['echo test\r', '\x03']);
    expect(native.resizes).toEqual([{ columns: 100, rows: 30 }]);
    expect(native.killCalls).toBe(1);
    expect(data).toEqual(['test\r\n']);
    expect(exits).toEqual([{ exitCode: 0 }]);
  });

  it('can force-terminate a Windows PTY process tree through an injected policy', () => {
    const native = new FakeNativePty();
    const killed: number[] = [];
    const module: NativePtyModule = { spawn: () => native };
    const pty = new NodePtySpawner(module, {
      forceKillProcessTree: (pid) => killed.push(pid),
    }).spawn({
      executable: 'bash.exe',
      args: [],
      cwd: 'C:/work',
      env: {},
      columns: 80,
      rows: 24,
    });

    pty.terminate();

    expect(killed).toEqual([123]);
  });
});
