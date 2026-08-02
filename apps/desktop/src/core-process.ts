import { spawn, type ChildProcess } from 'node:child_process';

export interface NodeCoreProcessOptions {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  gracefulStopTimeoutMs?: number;
}

export class NodeCoreProcessLauncher {
  readonly #options: NodeCoreProcessOptions;
  readonly #gracefulStopTimeoutMs: number;
  #child: ChildProcess | undefined;

  constructor(options: NodeCoreProcessOptions) {
    this.#options = options;
    this.#gracefulStopTimeoutMs = options.gracefulStopTimeoutMs ?? 2_000;
    if (!Number.isFinite(this.#gracefulStopTimeoutMs) || this.#gracefulStopTimeoutMs < 0) {
      throw new RangeError('gracefulStopTimeoutMs must be non-negative');
    }
  }

  get pid(): number | undefined {
    return this.#child?.pid;
  }

  async start(): Promise<void> {
    const existing = this.#child;
    if (existing !== undefined && existing.exitCode === null && !existing.killed) {
      // Give Node a bounded opportunity to deliver an externally-triggered
      // child exit before deciding whether the launcher can reuse the handle.
      await waitForExit(existing, 100);
      if (this.#child === existing) {
        if (existing.exitCode === null && !existing.killed) return;
        this.#child = undefined;
      } else if (this.#child !== undefined) {
        return;
      }
    }

    const child = spawn(this.#options.command, [...(this.#options.args ?? [])], {
      cwd: this.#options.cwd,
      env: this.#options.env === undefined ? process.env : { ...process.env, ...this.#options.env },
      stdio: process.env.TERMINAL_AGENT_DEBUG === '1' ? 'inherit' : 'ignore',
      windowsHide: true,
    });
    this.#child = child;
    child.once('exit', () => {
      if (this.#child === child) this.#child = undefined;
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve());
      child.once('error', reject);
    }).catch((error) => {
      if (this.#child === child) this.#child = undefined;
      throw error;
    });
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (child === undefined) return;
    if (child.exitCode !== null || child.killed) {
      this.#child = undefined;
      return;
    }

    if (await waitForExit(child, this.#gracefulStopTimeoutMs)) {
      if (this.#child === child) this.#child = undefined;
      return;
    }

    await new Promise<void>((resolve) => {
      const finish = (): void => {
        child.off('exit', finish);
        child.off('error', finish);
        if (this.#child === child) this.#child = undefined;
        resolve();
      };
      child.once('exit', finish);
      child.once('error', finish);
      if (child.exitCode !== null || child.killed) finish();
      else child.kill();
    });
  }
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.killed) return Promise.resolve(true);
  if (timeoutMs === 0) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (exited: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('error', onExit);
      resolve(exited);
    };
    const onExit = (): void => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
    child.once('error', onExit);
  });
}
