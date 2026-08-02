import { randomUUID } from 'node:crypto';

import { CommandExecutor } from '../execution/command-executor.js';
import type { SessionActor } from '../session/session-actor.js';
import {
  sessionResourceRefreshError,
  type RefreshSessionResourcesResult,
  type SessionResourceDialect,
  type SessionResourceRefreshErrorCode,
  type SessionResourceSnapshot,
} from './session-resource-domain.js';
import {
  buildSessionResourceCommands,
  parseSessionResourceOutput,
} from './session-resource-parser.js';
import { ShellProbe } from '../shell/shell-probe.js';

export interface SessionResourceCollector {
  collect(
    actor: SessionActor,
    dialect: SessionResourceDialect,
    commands: readonly string[],
    options?: { timeoutMs?: number },
  ): Promise<string>;
}

export interface SessionResourceAuditEvent {
  type: 'session.resources_refreshed' | 'session.resources_failed';
  sessionId: string;
  startedAt: string;
  completedAt: string;
  readOnlyPolicy: 'fixed_command';
  dialect?: SessionResourceDialect;
  status?: SessionResourceSnapshot['status'];
  collectedFields?: readonly SessionResourceMetricName[];
  error?: SessionResourceRefreshErrorCode;
}

export type SessionResourceMetricName =
  'host' | 'os' | 'uptime' | 'cpu' | 'memory' | 'swap' | 'disks' | 'network';

const SESSION_RESOURCE_METRIC_NAMES: readonly SessionResourceMetricName[] = [
  'host',
  'os',
  'uptime',
  'cpu',
  'memory',
  'swap',
  'disks',
  'network',
];

export class SessionResourceService {
  readonly #sessions: { get(sessionId: string): SessionActor | undefined };
  readonly #collector: SessionResourceCollector;
  readonly #isSessionBusy: (sessionId: string) => boolean;
  readonly #now: () => string;
  readonly #timeoutMs: number;
  readonly #audit: (event: SessionResourceAuditEvent) => void;
  readonly #snapshots = new Map<string, SessionResourceSnapshot>();

  constructor(options: {
    sessions: { get(sessionId: string): SessionActor | undefined };
    collector?: SessionResourceCollector;
    isSessionBusy?: (sessionId: string) => boolean;
    now?: () => string;
    timeoutMs?: number;
    audit?: (event: SessionResourceAuditEvent) => void;
  }) {
    this.#sessions = options.sessions;
    this.#collector = options.collector ?? new TerminalSessionResourceCollector();
    this.#isSessionBusy = options.isSessionBusy ?? (() => false);
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#timeoutMs = options.timeoutMs ?? 60_000;
    this.#audit = options.audit ?? (() => undefined);
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs <= 0) {
      throw new RangeError('timeoutMs must be a positive finite number');
    }
  }

  get(sessionId: string): SessionResourceSnapshot | undefined {
    const snapshot = this.#snapshots.get(sessionId);
    return snapshot === undefined ? undefined : structuredClone(snapshot);
  }

  async refresh(sessionId: string): Promise<RefreshSessionResourcesResult> {
    const startedAt = this.#now();
    const actor = this.#sessions.get(sessionId);
    if (actor === undefined) return this.#failure(sessionId, 'session_not_found', startedAt);
    if (this.#isSessionBusy(sessionId)) {
      return this.#failure(sessionId, 'lease_unavailable', startedAt);
    }
    const snapshot = actor.snapshot;
    if (
      snapshot.pty !== 'running' ||
      snapshot.shell === 'executing' ||
      snapshot.shell === 'interaction_required'
    ) {
      return this.#failure(sessionId, 'session_not_ready', startedAt);
    }
    if (snapshot.executionDialect === 'observe_only') {
      return this.#failure(sessionId, 'execution_dialect_unsupported', startedAt);
    }
    const dialect = snapshot.executionDialect;
    try {
      const output = await this.#collector.collect(
        actor,
        dialect,
        buildSessionResourceCommands(dialect),
        { timeoutMs: this.#timeoutMs },
      );
      const completedAt = this.#now();
      const resourceSnapshot = parseSessionResourceOutput(dialect, output, {
        collectedAt: completedAt,
      });
      this.#snapshots.set(sessionId, resourceSnapshot);
      this.#audit({
        type: 'session.resources_refreshed',
        sessionId,
        startedAt,
        completedAt,
        readOnlyPolicy: 'fixed_command',
        dialect,
        status: resourceSnapshot.status,
        collectedFields: SESSION_RESOURCE_METRIC_NAMES.filter(
          (name) => resourceSnapshot[name].status === 'available',
        ),
      });
      return { ok: true, snapshot: structuredClone(resourceSnapshot) };
    } catch (error) {
      const code =
        error instanceof SessionResourceCollectionError ? error.code : 'collection_failed';
      return this.#failure(sessionId, code, startedAt, dialect);
    }
  }

  #failure(
    sessionId: string,
    code: SessionResourceRefreshErrorCode,
    startedAt: string,
    dialect?: SessionResourceDialect,
  ): RefreshSessionResourcesResult {
    this.#audit({
      type: 'session.resources_failed',
      sessionId,
      startedAt,
      completedAt: this.#now(),
      readOnlyPolicy: 'fixed_command',
      ...(dialect === undefined ? {} : { dialect }),
      error: code,
    });
    return { ok: false, error: sessionResourceRefreshError(code) };
  }
}

class SessionResourceCollectionError extends Error {
  readonly code: SessionResourceRefreshErrorCode;

  constructor(code: SessionResourceRefreshErrorCode, message: string) {
    super(message);
    this.name = 'SessionResourceCollectionError';
    this.code = code;
  }
}

export class TerminalSessionResourceCollector implements SessionResourceCollector {
  readonly #timeoutMs: number;

  constructor(options: { timeoutMs?: number } = {}) {
    this.#timeoutMs = options.timeoutMs ?? 60_000;
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs <= 0) {
      throw new RangeError('timeoutMs must be a positive finite number');
    }
  }

  async collect(
    actor: SessionActor,
    _dialect: SessionResourceDialect,
    commands: readonly string[],
    options: { timeoutMs?: number } = {},
  ): Promise<string> {
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError('timeoutMs must be a positive finite number');
    }
    if (commands.length === 0) return '';
    const deadlineAt = Date.now() + timeoutMs;
    const taskId = `resource:${randomUUID()}`;
    let snapshot = actor.snapshot;
    const lease = await actor.grantAgentLease(taskId, snapshot.lease.epoch);
    if (!lease.ok) {
      throw new SessionResourceCollectionError('lease_unavailable', lease.error);
    }
    snapshot = lease.value;
    try {
      const environmentNeedsProbe =
        snapshot.environment.verificationStatus !== 'verified' ||
        snapshot.environment.platform === 'unknown' ||
        snapshot.environment.operatingSystem === 'unknown';
      if (environmentNeedsProbe && snapshot.shell === 'ready') {
        await actor.takeoverUser();
        const refreshedLease = await actor.grantAgentLease(taskId, actor.snapshot.lease.epoch);
        if (!refreshedLease.ok) {
          throw new SessionResourceCollectionError('lease_unavailable', refreshedLease.error);
        }
        snapshot = refreshedLease.value;
      }
      if (snapshot.shell !== 'ready' || environmentNeedsProbe) {
        if (remainingDeadlineMs(deadlineAt) <= 0) {
          throw new SessionResourceCollectionError(
            'collection_timeout',
            'resource collection deadline exceeded before probing',
          );
        }
        const probe = new ShellProbe(actor, { deadlineAt });
        try {
          const result = await probe.run({ taskId, leaseEpoch: snapshot.lease.epoch });
          if (result.mode !== 'structured') {
            if (result.reason === 'timeout') {
              throw new SessionResourceCollectionError(
                'collection_timeout',
                'resource collection deadline exceeded while probing',
              );
            }
            throw new SessionResourceCollectionError('session_not_ready', result.reason);
          }
        } finally {
          probe.dispose();
        }
      }
      const outputs: string[] = [];
      for (const command of commands) {
        const executeTimeoutMs = remainingDeadlineMs(deadlineAt);
        if (executeTimeoutMs <= 0) {
          throw new SessionResourceCollectionError(
            'collection_timeout',
            'resource collection deadline exceeded',
          );
        }
        const observationWindowMs = Math.min(250, executeTimeoutMs);
        const executor = new CommandExecutor(actor, {
          observationWindowMs,
          hardDeadlineMs: executeTimeoutMs,
          outputMaxBytes: 64 * 1024,
        });
        let result = await executor.execute({
          taskId,
          leaseEpoch: snapshot.lease.epoch,
          command,
          risk: 'read_only',
          observationWindowMs,
        });
        if (result.status === 'running') {
          const waitTimeoutMs = remainingDeadlineMs(deadlineAt);
          if (waitTimeoutMs <= 0) {
            throw new SessionResourceCollectionError(
              'collection_timeout',
              'resource collection deadline exceeded',
            );
          }
          result = await executor.wait({
            transactionId: result.transaction.id,
            timeoutMs: waitTimeoutMs,
          });
        }
        if (result.status === 'running' || result.deadlineExceeded) {
          throw new SessionResourceCollectionError(
            'collection_timeout',
            'resource command timed out',
          );
        }
        if (result.status !== 'completed') {
          throw new SessionResourceCollectionError(
            'collection_failed',
            `resource command ended with ${result.status}`,
          );
        }
        outputs.push(result.output.text);
      }
      return outputs.join('\n');
    } finally {
      await actor.takeoverUser();
    }
  }
}

function remainingDeadlineMs(deadlineAt: number): number {
  return deadlineAt - Date.now();
}
