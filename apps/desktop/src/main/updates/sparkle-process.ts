import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { record, releaseBaseUrl } from './github-release.js';
import type { SparkleCandidate, SparkleClient } from './macos-update-adapter.js';

export class SparkleProcess implements SparkleClient {
  readonly #executable: string;
  readonly #quit: () => void;
  #child: ChildProcessWithoutNullStreams | null = null;
  #authorized = false;

  constructor(executable: string, quit: () => void) {
    this.#executable = executable;
    this.#quit = quit;
  }

  async check(version: string, signal: AbortSignal): Promise<SparkleCandidate | null> {
    releaseBaseUrl(version);
    const result = await this.#run({ command: 'check', version }, signal);
    if (result.type === 'none') return null;
    if (
      result.type !== 'candidate' ||
      typeof result.version !== 'string' ||
      typeof result.url !== 'string' ||
      typeof result.length !== 'number' ||
      !Number.isSafeInteger(result.length) ||
      typeof result.signature !== 'string' ||
      typeof result.publicKey !== 'string'
    )
      throw new Error('Invalid Sparkle response');
    return {
      version: result.version,
      url: result.url,
      length: result.length,
      signature: result.signature,
      publicKey: result.publicKey,
    };
  }

  async prepare(candidate: SparkleCandidate): Promise<void> {
    releaseBaseUrl(candidate.version);
    const result = await this.#run({
      command: 'prepare',
      version: candidate.version,
      signature: candidate.signature,
      length: candidate.length,
    });
    if (result.type !== 'prepared')
      throw new Error('Sparkle could not prepare the target application');
  }

  async install(candidate: SparkleCandidate): Promise<void> {
    releaseBaseUrl(candidate.version);
    this.#authorized = true;
    const result = await this.#run({
      command: 'install',
      version: candidate.version,
      signature: candidate.signature,
      length: candidate.length,
    });
    if (result.type !== 'installing') throw new Error('Sparkle did not start installation');
    this.#quit();
  }

  #run(
    command: Record<string, string | number>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (this.#child) throw new Error('Sparkle operation already in progress');
    signal?.throwIfAborted();
    const child = spawn(this.#executable, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      windowsHide: true,
    });
    this.#child = child;
    child.stderr.resume();
    return new Promise((resolve, reject) => {
      let buffer = '';
      let settled = false;
      const timer = setTimeout(
        () => fail(new Error('Sparkle operation timed out')),
        this.#authorized ? 15 * 60_000 : 30_000,
      );
      timer.unref();
      const cleanup = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      };
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (!this.#authorized) child.kill();
        reject(error);
      };
      const abort = (): void => fail(new Error('Sparkle check cancelled'));
      signal?.addEventListener('abort', abort, { once: true });
      child.on('error', fail);
      child.stdin.on('error', fail);
      child.on('close', () => {
        if (this.#child === child) this.#child = null;
        if (!settled) fail(new Error('Sparkle helper exited before completing the operation'));
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (data: string) => {
        buffer += data;
        if (buffer.length > 65_536) {
          fail(new Error('Sparkle response too large'));
          return;
        }
        for (;;) {
          const newline = buffer.indexOf('\n');
          if (newline < 0) break;
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (settled) continue;
          try {
            const message = record(JSON.parse(line));
            if (message.type === 'error') {
              fail(new Error('Sparkle could not complete the update'));
              return;
            }
            const expected =
              command.command === 'check'
                ? ['candidate', 'none']
                : command.command === 'prepare'
                  ? ['prepared']
                  : ['installing'];
            if (typeof message.type !== 'string' || !expected.includes(message.type)) {
              throw new Error('Unexpected Sparkle message');
            }
            settled = true;
            cleanup();
            if (command.command !== 'install') {
              this.#child = null;
              child.stdin.end();
            }
            resolve(message);
          } catch {
            fail(new Error('Invalid Sparkle protocol'));
          }
        }
      });
      child.stdin.write(`${JSON.stringify(command)}\n`);
    });
  }

  async dispose(): Promise<void> {
    if (!this.#authorized) this.#child?.kill();
    else {
      this.#child?.stdin.end();
      this.#child?.unref();
    }
  }
}
