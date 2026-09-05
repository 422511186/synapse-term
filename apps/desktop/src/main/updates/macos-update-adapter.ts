import { createPublicKey, verify } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  discoverRelease,
  githubResponse,
  MAX_UPDATE_BYTES,
  type GithubRelease,
} from './github-release.js';
import {
  UpdateVerificationError,
  type DownloadProgress,
  type UpdateAdapter,
} from './update-adapter.js';

export interface SparkleCandidate {
  version: string;
  url: string;
  length: number;
  signature: string;
  publicKey: string;
}

export interface SparkleClient {
  check(version: string, signal: AbortSignal): Promise<SparkleCandidate | null>;
  prepare(candidate: SparkleCandidate): Promise<void>;
  install(candidate: SparkleCandidate): Promise<void>;
  dispose(): Promise<void>;
}

export interface MacosUpdateOptions {
  currentVersion: string;
  cacheDirectory: string;
  native: SparkleClient;
  fetcher?: typeof fetch;
}

export class MacosUpdateAdapter implements UpdateAdapter {
  readonly #options: MacosUpdateOptions;
  #candidate: SparkleCandidate | null = null;
  #release: GithubRelease | null = null;
  #directory: string | null = null;
  #file: string | null = null;
  #cacheReady: Promise<void> | null = null;

  constructor(options: MacosUpdateOptions) {
    this.#options = options;
  }

  async check(signal: AbortSignal) {
    this.#candidate = null;
    const release = await discoverRelease(
      'darwin',
      this.#options.currentVersion,
      signal,
      this.#options.fetcher,
    );
    if (!release) return null;
    const candidate = await this.#options.native.check(release.version, signal);
    signal.throwIfAborted();
    if (!candidate) return null;
    if (
      candidate.version !== release.version ||
      candidate.url !== release.assetUrl ||
      candidate.length !== release.assetSize ||
      !/^[A-Za-z0-9+/]{86}==$/.test(candidate.signature) ||
      !/^[A-Za-z0-9+/]{43}=$/.test(candidate.publicKey)
    ) {
      throw new Error('Invalid Sparkle update candidate');
    }
    this.#release = release;
    this.#candidate = candidate;
    return { version: release.version, releaseNotes: release.releaseNotes };
  }

  async download(
    signal: AbortSignal,
    onProgress: (value: DownloadProgress) => void,
  ): Promise<void> {
    const candidate = this.#candidate;
    if (!candidate || !this.#release) throw new Error('No macOS update candidate');
    await (this.#cacheReady ??= this.#clearStagingCache());
    signal.throwIfAborted();
    this.#file = null;
    if (this.#directory) await rm(this.#directory, { recursive: true, force: true });
    this.#directory = null;
    await mkdir(this.#options.cacheDirectory, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(this.#options.cacheDirectory, 'download-'));
    const path = join(directory, 'update.dmg');
    let retained = false;
    try {
      const response = await githubResponse(candidate.url, signal, this.#options.fetcher);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty update download');
      const file = await open(path, 'wx', 0o600);
      let received = 0;
      try {
        for (;;) {
          signal.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > MAX_UPDATE_BYTES || received > candidate.length)
            throw new UpdateVerificationError('Update size mismatch');
          await file.writeFile(value);
          onProgress({ phase: 'downloading', percent: (received / candidate.length) * 100 });
        }
      } finally {
        await file.close();
        await reader.cancel();
      }
      onProgress({ phase: 'verifying' });
      await verifyPackage(path, candidate);
      signal.throwIfAborted();
      this.#file = path;
      this.#directory = directory;
      retained = true;
    } finally {
      if (!retained) await rm(directory, { recursive: true, force: true });
    }
  }

  async prepare(): Promise<void> {
    if (!this.#candidate || !this.#file) throw new Error('Update package missing');
    await verifyPackage(this.#file, this.#candidate);
    await this.#options.native.prepare(this.#candidate);
  }

  async #clearStagingCache(): Promise<void> {
    const root = this.#options.cacheDirectory;
    await mkdir(root, { recursive: true, mode: 0o700 });
    // A crashed download never becomes installable after restart.
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('download-')) {
        await rm(join(root, entry.name), { recursive: true, force: true });
      }
    }
  }

  async install(): Promise<void> {
    if (!this.#candidate || !this.#file) throw new Error('Update is not ready');
    await this.#options.native.install(this.#candidate);
  }

  async dispose(): Promise<void> {
    try {
      await this.#options.native.dispose();
    } finally {
      if (this.#directory) await rm(this.#directory, { recursive: true, force: true });
      this.#directory = null;
      this.#file = null;
    }
  }
}

async function verifyPackage(path: string, candidate: SparkleCandidate): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile() || info.size !== candidate.length || info.size > MAX_UPDATE_BYTES) {
    throw new UpdateVerificationError('Invalid macOS update file');
  }
  const key = createPublicKey({
    format: 'jwk',
    key: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: Buffer.from(candidate.publicKey, 'base64').toString('base64url'),
    },
  });
  if (!verify(null, await readFile(path), key, Buffer.from(candidate.signature, 'base64'))) {
    throw new UpdateVerificationError('Invalid Ed25519 update signature');
  }
}
