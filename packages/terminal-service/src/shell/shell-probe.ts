import { randomUUID } from 'node:crypto';

import type { EnvironmentOperatingSystem } from '@synapse-term/domain';
import type { PtyDisposable } from './pty-adapter.js';
import type { SessionActor, SessionActorEvent } from '../session/session-actor.js';
import { PlaintextShellDispatcher } from '../execution/plaintext-dispatcher.js';
import { resolveShellDriver } from './shell-driver.js';

export interface ProbeScheduler {
  schedule(callback: () => void, delayMs: number): PtyDisposable;
}

export interface ShellProbeOptions {
  scheduler?: ProbeScheduler;
  timeoutMs?: number;
  deadlineAt?: number;
  nonceFactory?: () => string;
}

export interface ShellProbeInput {
  taskId: string;
  leaseEpoch: number;
}

export type ShellProbeResult =
  | { mode: 'structured'; capabilityEpoch: number; nonce: string }
  | {
      mode: 'observation_only';
      reason:
        | 'timeout'
        | 'nonzero_exit'
        | 'pty_exit'
        | 'write_rejected'
        | 'invalidated'
        | 'environment_unidentified'
        | 'busy';
      nonce: string;
    };

const systemScheduler: ProbeScheduler = {
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    return { dispose: () => clearTimeout(timer) };
  },
};

const DEFAULT_PROBE_TIMEOUT_MS = 30_000;

export class ShellProbe {
  readonly #actor: SessionActor;
  readonly #scheduler: ProbeScheduler;
  readonly #timeoutMs: number;
  readonly #deadlineAt: number | undefined;
  readonly #nonceFactory: () => string;
  readonly #dispatcher: PlaintextShellDispatcher;
  #active = false;
  #disposed = false;
  #cancelRequested = false;
  #cancelActive: (() => void) | undefined;

  constructor(actor: SessionActor, options: ShellProbeOptions = {}) {
    this.#actor = actor;
    this.#scheduler = options.scheduler ?? systemScheduler;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.#deadlineAt = options.deadlineAt;
    this.#nonceFactory = options.nonceFactory ?? randomUUID;
    this.#dispatcher = new PlaintextShellDispatcher(actor);
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs <= 0) {
      throw new RangeError('timeoutMs must be a positive finite number');
    }
    if (this.#deadlineAt !== undefined && !Number.isFinite(this.#deadlineAt)) {
      throw new RangeError('deadlineAt must be finite when provided');
    }
  }

  run(input: ShellProbeInput): Promise<ShellProbeResult> {
    if (this.#disposed) throw new Error('shell probe is disposed');
    const nonce = this.#nonceFactory();
    if (this.#active) {
      return Promise.resolve({ mode: 'observation_only', reason: 'busy', nonce });
    }
    this.#active = true;
    this.#cancelRequested = false;

    return this.#run(input, nonce, this.#deadlineAt ?? Date.now() + this.#timeoutMs);
  }

  cancel(): void {
    this.#cancelRequested = true;
    this.#cancelActive?.();
  }

  dispose(): void {
    this.#disposed = true;
    this.cancel();
  }

  async #run(input: ShellProbeInput, nonce: string, deadlineAt: number): Promise<ShellProbeResult> {
    if (remainingDeadlineMs(deadlineAt) <= 0) {
      this.#active = false;
      return { mode: 'observation_only', reason: 'timeout', nonce };
    }
    const initialSnapshot = this.#actor.snapshot;
    const requiresOperatingSystemFingerprint =
      initialSnapshot.environment.verificationStatus !== 'verified' ||
      initialSnapshot.environment.operatingSystem === 'unknown';
    if (initialSnapshot.executionDialect === 'observe_only') {
      this.#active = false;
      resolveShellDriver(initialSnapshot.executionDialect).buildProbe(nonce);
      throw new Error('observe-only shell driver unexpectedly built a probe');
    }
    let dialect: 'posix' | 'powershell' = initialSnapshot.executionDialect;
    let driver = resolveShellDriver(dialect);
    if (initialSnapshot.environment.verificationStatus !== 'verified') {
      const detectedDialect = await this.#fingerprintDialect(input, nonce, deadlineAt);
      if (detectedDialect === null) {
        this.#active = false;
        return {
          mode: 'observation_only',
          reason: this.#cancelRequested ? 'invalidated' : 'timeout',
          nonce,
        };
      }
      dialect = detectedDialect;
      driver = resolveShellDriver(detectedDialect);
    }

    if (remainingDeadlineMs(deadlineAt) <= 0) {
      this.#active = false;
      return { mode: 'observation_only', reason: 'timeout', nonce };
    }

    const probing = await this.#actor.transitionShell('probing').then(
      () => true,
      () => false,
    );
    if (!probing) {
      this.#active = false;
      return { mode: 'observation_only', reason: 'invalidated', nonce };
    }
    if (remainingDeadlineMs(deadlineAt) <= 0) {
      await this.#actor.transitionShell('unknown').catch(() => undefined);
      this.#active = false;
      return { mode: 'observation_only', reason: 'timeout', nonce };
    }

    return new Promise<ShellProbeResult>((resolve) => {
      let settled = false;
      let completionStarted = false;
      let output = '';
      const handles: { timer?: PtyDisposable; subscription?: PtyDisposable } = {};

      const finish = (result: ShellProbeResult, resetShell: boolean): void => {
        if (settled) return;
        settled = true;
        if (this.#cancelActive === cancelActive) this.#cancelActive = undefined;
        handles.timer?.dispose();
        handles.subscription?.dispose();
        void (async () => {
          if (resetShell && this.#actor.snapshot.shell === 'probing') {
            await this.#actor.transitionShell('unknown').catch(() => undefined);
          }
          this.#active = false;
          resolve(result);
        })();
      };

      const cancelActive = (): void =>
        finish({ mode: 'observation_only', reason: 'invalidated', nonce }, true);
      this.#cancelActive = cancelActive;

      const handleEvent = (event: SessionActorEvent): void => {
        if (event.type === 'pty_exit') {
          finish({ mode: 'observation_only', reason: 'pty_exit', nonce }, true);
          return;
        }
        if (event.type === 'pty_output') {
          output = `${output}${event.data}`.slice(-16_384);
          return;
        }
        if (event.type !== 'osc_777') return;

        const completion = driver.parseCompletion(event.payload);
        if (completion === null || completion.nonce !== nonce) return;
        if (completionStarted) return;
        if (completion.exitCode !== 0) {
          finish({ mode: 'observation_only', reason: 'nonzero_exit', nonce }, true);
          return;
        }

        const detectedOperatingSystem = parseOperatingSystemFingerprint(
          output,
          `__TA_OS_${nonce}__`,
        );
        if (requiresOperatingSystemFingerprint && detectedOperatingSystem === null) {
          finish({ mode: 'observation_only', reason: 'environment_unidentified', nonce }, true);
          return;
        }

        const snapshot = this.#actor.snapshot;
        if (
          snapshot.shell !== 'probing' ||
          snapshot.lease.epoch !== input.leaseEpoch ||
          snapshot.lease.owner.kind !== 'agent' ||
          snapshot.lease.owner.taskId !== input.taskId
        ) {
          finish({ mode: 'observation_only', reason: 'invalidated', nonce }, false);
          return;
        }

        const operatingSystem = detectedOperatingSystem ?? snapshot.environment.operatingSystem;
        if (operatingSystem === 'unknown') {
          finish({ mode: 'observation_only', reason: 'environment_unidentified', nonce }, true);
          return;
        }
        completionStarted = true;
        const platform = platformForOperatingSystem(operatingSystem);
        const shouldVerifyEnvironment =
          requiresOperatingSystemFingerprint ||
          detectedOperatingSystem !== null ||
          snapshot.environment.dialect !== dialect ||
          snapshot.environment.platform !== platform;

        void this.#actor
          .transitionShell('ready')
          .then(() => {
            if (!shouldVerifyEnvironment) return undefined;
            return this.#actor.verifyCurrentEnvironment(dialect, platform, operatingSystem);
          })
          .then(() => {
            finish(
              {
                mode: 'structured',
                capabilityEpoch: this.#actor.snapshot.shellCapabilityEpoch,
                nonce,
              },
              false,
            );
          })
          .catch(() => finish({ mode: 'observation_only', reason: 'invalidated', nonce }, true));
      };

      handles.subscription = this.#actor.onEvent(handleEvent);
      const timeoutMs = remainingDeadlineMs(deadlineAt);
      if (timeoutMs <= 0) {
        finish({ mode: 'observation_only', reason: 'timeout', nonce }, true);
        return;
      }
      handles.timer = this.#scheduler.schedule(
        () => finish({ mode: 'observation_only', reason: 'timeout', nonce }, true),
        timeoutMs,
      );

      if (remainingDeadlineMs(deadlineAt) <= 0) {
        finish({ mode: 'observation_only', reason: 'timeout', nonce }, true);
        return;
      }
      void this.#dispatcher
        .executeProbe({
          taskId: input.taskId,
          leaseEpoch: input.leaseEpoch,
          nonce,
          kind: 'capability',
          dialect,
        })
        .then((result) => {
          if (!result.ok) {
            finish({ mode: 'observation_only', reason: 'write_rejected', nonce }, true);
          }
        })
        .catch(() => finish({ mode: 'observation_only', reason: 'write_rejected', nonce }, true));
    });
  }

  async #fingerprintDialect(
    input: ShellProbeInput,
    nonce: string,
    deadlineAt: number,
  ): Promise<'posix' | 'powershell' | null> {
    const marker = `__TA_DIALECT_${nonce}__`;
    const timeoutMs = remainingDeadlineMs(deadlineAt);
    if (timeoutMs <= 0) return null;
    return new Promise<'posix' | 'powershell' | null>((resolve) => {
      let settled = false;
      let output = '';
      const resources: {
        timer?: PtyDisposable;
        subscription?: PtyDisposable;
      } = {};
      const finish = (dialect: 'posix' | 'powershell' | null): void => {
        if (settled) return;
        settled = true;
        if (this.#cancelActive === cancelActive) this.#cancelActive = undefined;
        resources.timer?.dispose();
        resources.subscription?.dispose();
        resolve(dialect);
      };

      const cancelActive = (): void => finish(null);
      this.#cancelActive = cancelActive;

      resources.subscription = this.#actor.onEvent((event) => {
        if (event.type === 'pty_exit') {
          finish(null);
          return;
        }
        if (event.type !== 'pty_output') return;
        output = `${output}${event.data}`.slice(-16_384);
        const dialect = parseDialectFingerprint(output, marker);
        if (dialect === null) return;
        void this.#actor
          .setExecutionDialect(dialect)
          .then(() => finish(dialect))
          .catch(() => finish(null));
      });
      resources.timer = this.#scheduler.schedule(() => finish(null), timeoutMs);

      if (remainingDeadlineMs(deadlineAt) <= 0) {
        finish(null);
        return;
      }
      void this.#dispatcher
        .executeProbe({
          taskId: input.taskId,
          leaseEpoch: input.leaseEpoch,
          nonce,
          kind: 'environment_fingerprint',
        })
        .then((result) => {
          if (!result.ok) finish(null);
        })
        .catch(() => finish(null));
    });
  }
}

function platformForOperatingSystem(
  operatingSystem: EnvironmentOperatingSystem,
): 'windows' | 'unix' {
  return operatingSystem === 'windows' ? 'windows' : 'unix';
}

function remainingDeadlineMs(deadlineAt: number): number {
  return deadlineAt - Date.now();
}

function parseDialectFingerprint(output: string, marker: string): 'posix' | 'powershell' | null {
  const escape = String.fromCharCode(0x1b);
  const ansiSequence = new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, 'g');
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.replace(ansiSequence, '').trim();
    const markerIndex = line.indexOf(marker);
    if (markerIndex < 0) continue;
    const suffix = line.slice(markerIndex + marker.length).replace(/^:/, '');
    if (suffix.includes('${0}') || suffix.includes('${PSVersionTable}')) continue;
    const values = suffix.split(':');
    const shellName = values[0]?.trim() ?? '';
    if (shellName.length > 0) return 'posix';
    if (values.length > 1) return 'powershell';
  }
  return null;
}

export function parseOperatingSystemFingerprint(
  output: string,
  marker: string,
): EnvironmentOperatingSystem | null {
  const escape = String.fromCharCode(0x1b);
  const ansiSequence = new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, 'g');
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.replace(ansiSequence, '').trim();
    const markerIndex = line.indexOf(marker);
    if (markerIndex < 0) continue;
    const fingerprint = line
      .slice(markerIndex + marker.length)
      .replace(/^:/, '')
      .trim();
    if (fingerprint.length === 0) continue;
    if (/^(?:mingw|msys|cygwin)/i.test(fingerprint)) return 'windows';
    if (/(?:windows|win32nt)/i.test(fingerprint)) return 'windows';
    if (/^linux\b/i.test(fingerprint) || /\blinux\b/i.test(fingerprint)) return 'linux';
    if (/^(?:darwin|macos|mac os x|os x)\b/i.test(fingerprint)) return 'macos';
  }
  return null;
}
