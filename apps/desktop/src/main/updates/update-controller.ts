import { randomUUID } from 'node:crypto';

import semver from 'semver';

import type { InstallationImpact, UpdateState } from '../../shared/update-contracts.js';
import { UpdateVerificationError, type UpdateAdapter } from './update-adapter.js';

export interface UpdateControllerOptions {
  currentVersion: string;
  adapter: UpdateAdapter | null;
  automaticChecks: boolean;
  saveAutomaticChecks: (enabled: boolean) => Promise<void>;
  getSessionIds: () => readonly string[];
  shutdownForInstall: () => Promise<void>;
  unsupportedReason?: string;
}

export class UpdateController {
  readonly #options: UpdateControllerOptions;
  #state: UpdateState;
  #checking: Promise<UpdateState> | null = null;
  #abort: AbortController | null = null;
  #disposed = false;
  #nextCheckAt = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #preferences = Promise.resolve();
  readonly #listeners = new Set<(state: UpdateState) => void>();
  #downloadGeneration = 0;
  #downloading: Promise<UpdateState> | null = null;
  #installing = false;
  #confirmation: { id: string; candidateId: string; sessions: string; expires: number } | null =
    null;

  constructor(options: UpdateControllerOptions) {
    this.#options = options;
    this.#state = {
      phase: options.adapter ? 'idle' : 'unsupported',
      currentVersion: options.currentVersion,
      automaticChecks: options.automaticChecks,
      lastCheckedAt: null,
      candidate: null,
      progress: null,
      error: null,
      unsupportedReason: options.adapter
        ? null
        : (options.unsupportedReason ?? '此平台不支持应用内更新'),
    };
    this.#schedule(15_000);
  }

  getState(): UpdateState {
    return structuredClone(this.#state);
  }

  onChanged(listener: (state: UpdateState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #publish(): void {
    if (this.#disposed) return;
    for (const listener of this.#listeners) listener(this.getState());
  }

  async setAutomaticChecks(enabled: boolean): Promise<UpdateState> {
    if (typeof enabled !== 'boolean') throw new Error('Invalid update preference');
    const save = this.#preferences
      .catch(() => undefined)
      .then(async () => {
        await this.#options.saveAutomaticChecks(enabled);
        this.#state.automaticChecks = enabled;
        this.#schedule(15_000);
        this.#publish();
      });
    this.#preferences = save;
    await save;
    return this.getState();
  }

  #schedule(delay: number): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#disposed || !this.#state.automaticChecks || !this.#options.adapter) return;
    this.#timer = setTimeout(() => {
      void this.check().finally(() => this.#schedule(6 * 60 * 60 * 1000));
    }, delay);
    this.#timer.unref?.();
  }

  check(): Promise<UpdateState> {
    if (this.#checking) return this.#checking;
    if (
      this.#disposed ||
      !this.#options.adapter ||
      Date.now() < this.#nextCheckAt ||
      this.#downloading ||
      this.#installing ||
      this.#state.phase === 'ready'
    ) {
      return Promise.resolve(this.getState());
    }
    this.#nextCheckAt = Date.now() + 30_000;
    this.#checking = this.#check().finally(() => {
      this.#checking = null;
    });
    return this.#checking;
  }

  async #check(): Promise<UpdateState> {
    const engine = this.#options.adapter;
    if (!engine) return this.getState();
    this.#state.phase = 'checking';
    this.#state.candidate = null;
    this.#confirmation = null;
    this.#state.error = null;
    this.#publish();
    const abort = new AbortController();
    this.#abort = abort;
    const timer = setTimeout(() => abort.abort(new Error('Update check timed out')), 30_000);
    timer.unref?.();
    try {
      const candidate = await abortable(engine.check(abort.signal), abort.signal);
      const eligible =
        candidate &&
        semver.valid(candidate.version) === candidate.version &&
        !semver.prerelease(candidate.version) &&
        !candidate.version.includes('+') &&
        semver.gt(candidate.version, this.#state.currentVersion);
      this.#state.candidate = eligible ? { id: randomUUID(), ...candidate } : null;
      this.#state.phase = eligible ? 'available' : 'idle';
    } catch {
      this.#state.phase = 'error';
      this.#state.error = { stage: 'check', message: '检查更新失败，请稍后重试。' };
    } finally {
      clearTimeout(timer);
      this.#abort = null;
    }
    this.#state.lastCheckedAt = new Date().toISOString();
    this.#publish();
    return this.getState();
  }

  download(candidateId: string): Promise<UpdateState> {
    if (this.#downloading) return this.#downloading;
    this.#requireCandidate(candidateId);
    if (this.#checking || this.#installing || this.#state.phase === 'ready') {
      throw new Error('更新当前不可下载');
    }
    this.#confirmation = null;
    this.#downloading = this.#download().finally(() => {
      this.#downloading = null;
    });
    return this.#downloading;
  }

  async #download(): Promise<UpdateState> {
    const engine = this.#options.adapter!;
    const generation = ++this.#downloadGeneration;
    const abort = new AbortController();
    this.#abort = abort;
    const timer = setTimeout(() => abort.abort(new Error('Download timed out')), 15 * 60 * 1000);
    timer.unref?.();
    this.#state.phase = 'downloading';
    this.#state.progress = null;
    this.#state.error = null;
    this.#publish();
    const isCurrent = (): boolean => generation === this.#downloadGeneration && !this.#disposed;
    try {
      await abortable(
        engine.download(abort.signal, (progress) => {
          if (!isCurrent() || abort.signal.aborted) return;
          this.#state.phase = progress.phase;
          this.#state.progress =
            progress.phase === 'downloading' &&
            progress.percent !== null &&
            Number.isFinite(progress.percent)
              ? Math.max(0, Math.min(100, progress.percent))
              : null;
          this.#publish();
        }),
        abort.signal,
      );
      if (isCurrent()) {
        this.#state.phase = 'ready';
        this.#state.progress = 100;
      }
    } catch (error) {
      if (isCurrent()) {
        this.#state.phase = 'error';
        this.#state.progress = null;
        this.#state.error =
          error instanceof UpdateVerificationError
            ? { stage: 'verify', message: '更新包校验失败，请重新下载。' }
            : { stage: 'download', message: '下载更新失败，请检查网络后重试。' };
      }
    } finally {
      clearTimeout(timer);
      if (this.#abort === abort) this.#abort = null;
    }
    this.#publish();
    return this.getState();
  }

  async cancel(): Promise<UpdateState> {
    if (!this.#downloading || this.#installing) return this.getState();
    this.#downloadGeneration++;
    this.#abort?.abort();
    this.#state.phase = 'available';
    this.#state.progress = null;
    this.#state.error = null;
    this.#confirmation = null;
    this.#publish();
    await this.#downloading;
    return this.getState();
  }

  #requireCandidate(id: string): NonNullable<UpdateState['candidate']> {
    if (
      this.#disposed ||
      !this.#options.adapter ||
      !this.#state.candidate ||
      this.#state.candidate.id !== id
    ) {
      throw new Error('更新候选已变化，请重新检查');
    }
    return this.#state.candidate;
  }

  #sessions(): string {
    return JSON.stringify([...this.#options.getSessionIds()].sort());
  }

  getInstallImpact(candidateId: string): InstallationImpact {
    const candidate = this.#requireCandidate(candidateId);
    if (
      this.#installing ||
      (this.#state.phase !== 'ready' && this.#state.error?.stage !== 'prepare')
    ) {
      throw new Error('更新包尚未准备好');
    }
    const confirmationId = randomUUID();
    this.#confirmation = {
      id: confirmationId,
      candidateId,
      sessions: this.#sessions(),
      expires: Date.now() + 60_000,
    };
    return {
      candidateId,
      version: candidate.version,
      sessionCount: this.#options.getSessionIds().length,
      confirmationId,
    };
  }

  async install(candidateId: string, confirmationId: string): Promise<UpdateState> {
    this.#requireCandidate(candidateId);
    const confirmation = this.#confirmation;
    if (
      this.#installing ||
      !confirmation ||
      confirmation.id !== confirmationId ||
      confirmation.candidateId !== candidateId ||
      confirmation.expires <= Date.now() ||
      confirmation.sessions !== this.#sessions()
    ) {
      this.#confirmation = null;
      throw new Error('安装确认已失效，请重新确认当前 Session');
    }
    this.#confirmation = null;
    this.#installing = true;
    this.#state.phase = 'installing';
    this.#state.error = null;
    this.#publish();
    let sessionsStopped = false;
    try {
      await this.#options.adapter!.prepare();
      if (
        this.#disposed ||
        confirmation.expires <= Date.now() ||
        confirmation.sessions !== this.#sessions()
      ) {
        throw new Error('Session 集合已变化');
      }
      // The shutdown callback closes ingress synchronously before its first await.
      sessionsStopped = true;
      await this.#options.shutdownForInstall();
      if (this.#disposed) throw new Error('应用正在退出');
      await this.#options.adapter!.install();
    } catch (error) {
      this.#installing = sessionsStopped;
      this.#state.phase = 'error';
      this.#state.error = {
        stage: sessionsStopped
          ? 'install'
          : error instanceof UpdateVerificationError
            ? 'verify'
            : 'prepare',
        message: sessionsStopped
          ? '安装失败，已结束的 Session 无法恢复。请重新启动应用或手动下载安装。'
          : '安装准备失败或 Session 已变化，Session 未被结束。请重新下载或确认。',
      };
    }
    this.#publish();
    return this.getState();
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#confirmation = null;
    this.#downloadGeneration++;
    if (this.#timer) clearTimeout(this.#timer);
    this.#abort?.abort();
    this.#listeners.clear();
    await this.#options.adapter?.dispose();
  }
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
