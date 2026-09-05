import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';

import { autoUpdater } from 'electron';
import { CancellationToken, NsisUpdater, type ProgressInfo } from 'electron-updater';

import { discoverRelease, releaseBaseUrl, type GithubRelease } from './github-release.js';
import {
  UpdateVerificationError,
  type DownloadProgress,
  type UpdateAdapter,
} from './update-adapter.js';

export class WindowsUpdateAdapter implements UpdateAdapter {
  readonly #currentVersion: string;
  readonly #onInstallError: () => void;
  #updater: NsisUpdater | null = null;
  #release: GithubRelease | null = null;
  #sha512: string | null = null;
  #downloaded: string | null = null;
  #cancellation: CancellationToken | null = null;
  #rejectInstall: ((error: Error) => void) | null = null;
  #installRequested = false;

  constructor(currentVersion: string, onInstallError: () => void) {
    this.#currentVersion = currentVersion;
    this.#onInstallError = onInstallError;
  }

  async check(signal: AbortSignal) {
    this.#release = null;
    this.#downloaded = null;
    const release = await discoverRelease('win32', this.#currentVersion, signal);
    if (!release) return null;
    const updater = new NsisUpdater({
      provider: 'generic',
      url: release.baseUrl,
      useMultipleRangeRequest: false,
    });
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.autoRunAppAfterInstall = true;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.disableWebInstaller = true;
    updater.previousBlockmapBaseUrlOverride = releaseBaseUrl(this.#currentVersion);
    updater.logger = null;
    updater.on('error', (error: Error) => {
      // Check/download errors also reject their promises. Install launch failures use this event.
      if (this.#updater === updater && this.#installRequested) {
        this.#rejectInstall?.(error);
        this.#onInstallError();
      }
    });
    const result = await updater.checkForUpdates();
    signal.throwIfAborted();
    if (!result?.isUpdateAvailable) return null;
    const info = result.updateInfo;
    const file = info.files[0];
    if (
      info.version !== release.version ||
      info.files.length !== 1 ||
      !file ||
      'packages' in info ||
      new URL(file.url, release.baseUrl).href !== release.assetUrl ||
      file.size !== release.assetSize ||
      !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)
    )
      throw new Error('Invalid Windows update manifest');
    this.#updater = updater;
    this.#sha512 = file.sha512;
    this.#release = release;
    return { version: release.version, releaseNotes: release.releaseNotes };
  }

  async download(
    signal: AbortSignal,
    onProgress: (value: DownloadProgress) => void,
  ): Promise<void> {
    const updater = this.#updater;
    if (!updater || !this.#release) throw new Error('No Windows update candidate');
    this.#cancellation?.cancel();
    const cancellation = new CancellationToken();
    this.#cancellation = cancellation;
    const abort = (): void => cancellation.cancel();
    const progress = (value: ProgressInfo): void => {
      if (!signal.aborted) onProgress({ phase: 'downloading', percent: value.percent });
    };
    signal.addEventListener('abort', abort, { once: true });
    updater.on('download-progress', progress);
    try {
      signal.throwIfAborted();
      const files = await updater.downloadUpdate(cancellation);
      signal.throwIfAborted();
      this.#downloaded = files[0] ?? null;
      onProgress({ phase: 'verifying' });
      await this.prepare();
      signal.throwIfAborted();
    } catch (error) {
      if (error instanceof Error && /checksum|sha512|signature/i.test(error.message)) {
        throw new UpdateVerificationError('Windows package verification failed');
      }
      throw error;
    } finally {
      updater.removeListener('download-progress', progress);
      signal.removeEventListener('abort', abort);
    }
  }

  async prepare(): Promise<void> {
    if (!this.#downloaded || !this.#sha512 || !this.#release)
      throw new Error('Update package missing');
    const info = await lstat(this.#downloaded);
    if (!info.isFile() || info.size !== this.#release.assetSize)
      throw new UpdateVerificationError('Invalid update file');
    const hash = createHash('sha512');
    for await (const chunk of createReadStream(this.#downloaded)) hash.update(chunk);
    if (hash.digest('base64') !== this.#sha512)
      throw new UpdateVerificationError('Update checksum changed');
  }

  async install(): Promise<void> {
    if (!this.#updater || !this.#downloaded) throw new Error('Update not ready');
    this.#installRequested = true;
    let submitted = (): void => undefined;
    const installing = new Promise<void>((resolve, reject) => {
      this.#rejectInstall = reject;
      submitted = resolve;
      autoUpdater.once('before-quit-for-update', submitted);
      // NSIS waits for the application to quit and restarts it via --force-run.
      this.#updater!.quitAndInstall(true, true);
    });
    try {
      await installing;
    } finally {
      this.#rejectInstall = null;
      autoUpdater.removeListener('before-quit-for-update', submitted);
    }
  }

  async dispose(): Promise<void> {
    this.#cancellation?.cancel();
  }
}
