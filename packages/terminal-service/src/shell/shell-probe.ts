import { randomUUID } from 'node:crypto';

import type { CurrentPtyEnvironment } from '@synapse-term/domain';

import { parseEnvironmentFingerprint, PosixShellDriver } from './shell-driver.js';
import type { SessionActor, SessionActorEvent } from '../session/session-actor.js';

export interface ShellProbeOptions {
  timeoutMs?: number;
  nonceFactory?: () => string;
}

export interface ShellProbeInput {
  environmentEpoch: number;
}

export type ShellProbeResult =
  | {
      mode: 'structured';
      dialect: 'posix' | 'powershell';
      platform: 'unix' | 'windows';
      capabilityEpoch: number;
    }
  | {
      mode: 'observation_only';
      reason: 'timeout' | 'invalidated' | 'pty_exit' | 'write_rejected' | 'ambiguous' | 'busy';
    };

const DEFAULT_TIMEOUT_MS = 30_000;

export class ShellProbe {
  readonly #actor: SessionActor;
  readonly #timeoutMs: number;
  readonly #nonceFactory: () => string;
  #active = false;
  #disposed = false;
  #cancelActive: (() => void) | undefined;

  constructor(actor: SessionActor, options: ShellProbeOptions = {}) {
    this.#actor = actor;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#nonceFactory = options.nonceFactory ?? randomUUID;
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs <= 0) {
      throw new RangeError('timeoutMs must be a positive finite number');
    }
  }

  run(input: ShellProbeInput): Promise<ShellProbeResult> {
    if (this.#disposed) throw new Error('shell probe is disposed');
    const current = this.#actor.snapshot.environment;
    if (current.capabilityEpoch !== input.environmentEpoch) {
      return Promise.resolve({ mode: 'observation_only', reason: 'invalidated' });
    }
    if (current.verificationStatus === 'verified' && current.dialect !== 'unknown') {
      return Promise.resolve(structuredResult(current));
    }
    if (this.#active) return Promise.resolve({ mode: 'observation_only', reason: 'busy' });

    this.#active = true;
    const nonce = this.#nonceFactory();
    const startEpoch = input.environmentEpoch;
    const payload = new PosixShellDriver().buildEnvironmentProbe(nonce);
    this.#actor.suppressEnvironmentProbeEcho(nonce);

    return new Promise<ShellProbeResult>((resolve) => {
      let settled = false;
      let output = '';

      const finish = (result: ShellProbeResult): void => {
        if (settled) return;
        settled = true;
        if (this.#cancelActive === cancel) this.#cancelActive = undefined;
        clearTimeout(timer);
        removeListener();
        this.#active = false;
        void this.#actor.releaseEnvironmentProbeEcho(nonce);
        resolve(result);
      };

      const cancel = (): void => finish({ mode: 'observation_only', reason: 'invalidated' });
      this.#cancelActive = cancel;

      const onEvent = (event: SessionActorEvent): void => {
        if (event.type === 'pty_exit') {
          finish({ mode: 'observation_only', reason: 'pty_exit' });
          return;
        }
        if (event.type === 'environment_invalidated') {
          finish({ mode: 'observation_only', reason: 'invalidated' });
          return;
        }
        if (event.type !== 'pty_output') return;
        output = `${output}${event.data}`.slice(-16_384);
        const identified = parseEnvironmentFingerprint(output, nonce);
        if (identified === null) return;
        if (this.#actor.snapshot.environment.capabilityEpoch !== startEpoch) {
          finish({ mode: 'observation_only', reason: 'invalidated' });
          return;
        }
        void this.#actor
          .verifyEnvironment(identified.dialect, identified.platform)
          .then(() => {
            const environment = this.#actor.snapshot.environment;
            if (environment.capabilityEpoch <= startEpoch) {
              finish({ mode: 'observation_only', reason: 'invalidated' });
              return;
            }
            finish({
              mode: 'structured',
              dialect: identified.dialect,
              platform: identified.platform,
              capabilityEpoch: environment.capabilityEpoch,
            });
          })
          .catch(() => finish({ mode: 'observation_only', reason: 'invalidated' }));
      };

      const removeListener = this.#actor.onEvent(onEvent);
      const timer = setTimeout(
        () => finish({ mode: 'observation_only', reason: 'timeout' }),
        this.#timeoutMs,
      );
      void this.#actor.writeProbe(payload).then((result) => {
        if (!result.ok) finish({ mode: 'observation_only', reason: 'write_rejected' });
      });
    });
  }

  cancel(): void {
    this.#cancelActive?.();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.cancel();
  }
}

function structuredResult(environment: CurrentPtyEnvironment): ShellProbeResult {
  if (
    environment.verificationStatus !== 'verified' ||
    environment.dialect === 'unknown' ||
    environment.platform === 'unknown'
  ) {
    return { mode: 'observation_only', reason: 'ambiguous' };
  }
  return {
    mode: 'structured',
    dialect: environment.dialect,
    platform: environment.platform,
    capabilityEpoch: environment.capabilityEpoch,
  };
}
