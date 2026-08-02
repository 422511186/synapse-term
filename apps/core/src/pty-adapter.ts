import * as nodePty from 'node-pty';
import { spawnSync } from 'node:child_process';

export interface PtyDisposable {
  dispose(): void;
}

export interface NativePtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): PtyDisposable;
  onExit(
    listener: (event: { exitCode: number; signal?: number | undefined }) => void,
  ): PtyDisposable;
}

export interface NativePtySpawnOptions {
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  name: string;
  useConpty: boolean;
}

export interface NativePtyModule {
  spawn(file: string, args: readonly string[], options: NativePtySpawnOptions): NativePtyProcess;
}

export interface PtySpawnOptions {
  executable: string;
  args: readonly string[];
  cwd: string;
  env: Record<string, string>;
  columns: number;
  rows: number;
  terminalName?: string;
}

export interface PtyAdapter {
  readonly pid: number;
  write(data: string): void;
  resize(columns: number, rows: number): void;
  interrupt(): void;
  terminate(): void;
  onData(listener: (data: string) => void): PtyDisposable;
  onExit(
    listener: (event: { exitCode: number; signal?: number | undefined }) => void,
  ): PtyDisposable;
}

export interface PtySpawner {
  spawn(options: PtySpawnOptions): PtyAdapter;
}

export interface NodePtySpawnerOptions {
  forceKillProcessTree?: (pid: number) => void;
}

class NodePtyProcessAdapter implements PtyAdapter {
  readonly #native: NativePtyProcess;
  readonly #forceKillProcessTree: (pid: number) => void;

  constructor(native: NativePtyProcess, forceKillProcessTree: (pid: number) => void) {
    this.#native = native;
    this.#forceKillProcessTree = forceKillProcessTree;
  }

  get pid(): number {
    return this.#native.pid;
  }

  write(data: string): void {
    this.#native.write(data);
  }

  resize(columns: number, rows: number): void {
    validateSize(columns, rows);
    this.#native.resize(columns, rows);
  }

  interrupt(): void {
    this.#native.write('\x03');
  }

  terminate(): void {
    this.#native.kill();
    this.#forceKillProcessTree(this.#native.pid);
  }

  onData(listener: (data: string) => void): PtyDisposable {
    return this.#native.onData(listener);
  }

  onExit(
    listener: (event: { exitCode: number; signal?: number | undefined }) => void,
  ): PtyDisposable {
    return this.#native.onExit(listener);
  }
}

function validateSize(columns: number, rows: number): void {
  if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) {
    throw new RangeError('PTY columns and rows must be positive integers');
  }
}

export class NodePtySpawner implements PtySpawner {
  readonly #module: NativePtyModule;
  readonly #forceKillProcessTree: (pid: number) => void;

  constructor(
    module: NativePtyModule = nodePty as unknown as NativePtyModule,
    options: NodePtySpawnerOptions = {},
  ) {
    this.#module = module;
    this.#forceKillProcessTree =
      options.forceKillProcessTree ??
      (module === (nodePty as unknown as NativePtyModule) && process.platform === 'win32'
        ? forceKillWindowsProcessTree
        : forceKillPosixProcessTree);
  }

  spawn(options: PtySpawnOptions): PtyAdapter {
    validateSize(options.columns, options.rows);
    const native = this.#module.spawn(options.executable, options.args, {
      cwd: options.cwd,
      env: options.env,
      cols: options.columns,
      rows: options.rows,
      name: options.terminalName ?? 'xterm-256color',
      useConpty: process.platform === 'win32',
    });
    return new NodePtyProcessAdapter(native, this.#forceKillProcessTree);
  }
}

function forceKillWindowsProcessTree(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
    timeout: 5_000,
  });
}

function forceKillPosixProcessTree(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    // Process group may already be gone.
    return;
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Already exited.
    }
  }, 2_000);
}
