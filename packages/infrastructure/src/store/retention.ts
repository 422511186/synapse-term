import { cleanupExpiredRawLogs } from '../security/data-security.js';
import type { CoreRepositories } from './repositories.js';

export interface RetentionOptions {
  rawRetentionMs?: number;
  auditRetentionMs?: number;
}

export class RetentionManager {
  readonly #rawDirectory: string;
  readonly #repositories: CoreRepositories;
  readonly #rawRetentionMs: number;
  readonly #auditRetentionMs: number;

  constructor(
    rawDirectory: string,
    repositories: CoreRepositories,
    options: RetentionOptions = {},
  ) {
    this.#rawDirectory = rawDirectory;
    this.#repositories = repositories;
    this.#rawRetentionMs = options.rawRetentionMs ?? 24 * 60 * 60 * 1000;
    this.#auditRetentionMs = options.auditRetentionMs ?? 30 * 24 * 60 * 60 * 1000;
    if (this.#rawRetentionMs < 0 || this.#auditRetentionMs < 0) {
      throw new RangeError('retention durations must be non-negative');
    }
  }

  async cleanup(now: number): Promise<{ rawLogs: number; auditEvents: number }> {
    if (!Number.isFinite(now)) throw new RangeError('cleanup time must be finite');
    const rawLogs = await cleanupExpiredRawLogs(this.#rawDirectory, now - this.#rawRetentionMs);
    const cutoff = new Date(now - this.#auditRetentionMs).toISOString();
    const auditEvents = this.#repositories.deleteAuditEventsBefore(cutoff);
    return { rawLogs, auditEvents };
  }
}
