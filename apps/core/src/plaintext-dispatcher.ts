import type {
  ExecutionDialect,
  EnvironmentPlatform,
  TransportMode,
  SourceKind,
} from '@terminal-agent/domain';

import { hashCommand } from './approval-manager.js';
import { type SessionActor, type AgentWriteInput } from './session-actor.js';
import {
  resolveShellDriver,
  shellInputLines,
  type ShellDriver,
  ShellDriverError,
} from './shell-driver.js';

export interface PlaintextDispatchInput {
  readonly sessionId: string;
  readonly taskId: string;
  readonly leaseEpoch: number;
  readonly command: string;
  readonly nonce: string;
  readonly dialect: ExecutionDialect;
  readonly platform: EnvironmentPlatform;
  readonly environmentEpoch: number;
  readonly sourceKind: SourceKind;
  readonly approvalGrantId?: string;
}

export interface PlaintextDispatchResult {
  readonly ok: true;
  readonly transportMode: TransportMode;
  readonly commandHash: string;
  readonly dialect: ExecutionDialect;
  readonly platform: EnvironmentPlatform;
  readonly environmentEpoch: number;
  readonly wrappedCommand: string;
}

export interface PlaintextDispatchError {
  readonly ok: false;
  readonly errorCode:
    'execution_environment_unverified' | 'command_not_auditable' | 'plaintext_protocol_error';
  readonly message: string;
}

export type DispatchResult = PlaintextDispatchResult | PlaintextDispatchError;

export type PlaintextProbeKind = 'environment_fingerprint' | 'capability';

/**
 * Probe payloads are intentionally closed over a fixed source set. Callers
 * cannot supply arbitrary source while the environment is still unverified.
 */
export interface PlaintextProbeDispatchInput {
  readonly taskId: string;
  readonly leaseEpoch: number;
  readonly nonce: string;
  readonly kind: PlaintextProbeKind;
  readonly dialect?: Exclude<ExecutionDialect, 'observe_only'>;
}

export type PlaintextDispatchExecutionResult =
  | PlaintextDispatchError
  | (PlaintextDispatchResult & {
      readonly writeResult: Awaited<ReturnType<SessionActor['writeAgent']>>;
    });

export type PlaintextProbeDispatchResult =
  | PlaintextDispatchError
  | {
      readonly ok: true;
      readonly kind: PlaintextProbeKind;
      readonly payload: string;
      readonly writeResult: Awaited<ReturnType<SessionActor['writeAgent']>>;
    };

/**
 * Central dispatch for all Agent-generated PTY shell execution.
 * Validates environment, constructs plaintext wrapper, checks safety,
 * and writes to the PTY. No caller should bypass this for Agent commands.
 */
export class PlaintextShellDispatcher {
  readonly #actor: SessionActor;

  constructor(actor: SessionActor) {
    this.#actor = actor;
  }

  /**
   * Validate the dispatch preconditions, construct the plaintext wrapper,
   * and return the attestation. Does NOT write to PTY -- use `execute` for that.
   */
  prepare(input: PlaintextDispatchInput): DispatchResult {
    if (input.dialect === 'observe_only') {
      return {
        ok: false,
        errorCode: 'execution_environment_unverified',
        message: 'Current environment is observation-only; cannot execute commands',
      };
    }

    const snapshot = this.#actor.snapshot;

    if (input.sessionId !== snapshot.id) {
      return this.#protocolError('Dispatch session does not match the current SessionActor');
    }
    if (input.sourceKind !== 'plaintext_shell') {
      return this.#protocolError('Plaintext dispatcher only accepts plaintext shell sources');
    }
    if (snapshot.environment.verificationStatus !== 'verified') {
      return {
        ok: false,
        errorCode: 'execution_environment_unverified',
        message: 'Current PTY environment has not been verified',
      };
    }
    if (
      snapshot.environment.platform === 'unknown' ||
      snapshot.environment.operatingSystem === 'unknown'
    ) {
      return {
        ok: false,
        errorCode: 'execution_environment_unverified',
        message: 'Current PTY operating system identity is unknown',
      };
    }

    if (snapshot.environment.capabilityEpoch !== input.environmentEpoch) {
      return {
        ok: false,
        errorCode: 'execution_environment_unverified',
        message: `Environment epoch mismatch: expected ${input.environmentEpoch}, current ${snapshot.environment.capabilityEpoch}`,
      };
    }
    if (
      snapshot.environment.dialect !== input.dialect ||
      snapshot.environment.platform !== input.platform
    ) {
      return this.#protocolError(
        'Dispatch environment does not match the verified current environment',
      );
    }
    if (
      snapshot.lease.epoch !== input.leaseEpoch ||
      snapshot.lease.owner.kind !== 'agent' ||
      snapshot.lease.owner.taskId !== input.taskId
    ) {
      return this.#protocolError('Agent lease is no longer valid for plaintext dispatch');
    }
    if (!isSafeTransactionNonce(input.nonce)) {
      return this.#protocolError('Dispatch nonce contains unsupported characters');
    }

    let driver: ShellDriver;
    try {
      driver = resolveShellDriver(input.dialect);
    } catch {
      return {
        ok: false,
        errorCode: 'execution_environment_unverified',
        message: `No shell driver available for dialect: ${input.dialect}`,
      };
    }

    let wrappedCommand: string;
    try {
      wrappedCommand = driver.wrapCommand(input.command, input.nonce);
    } catch (error) {
      if (error instanceof ShellDriverError) {
        return {
          ok: false,
          errorCode:
            error.code === 'command_not_auditable'
              ? 'command_not_auditable'
              : 'plaintext_protocol_error',
          message: error.message,
        };
      }
      return {
        ok: false,
        errorCode: 'plaintext_protocol_error',
        message: error instanceof Error ? error.message : 'Failed to construct plaintext wrapper',
      };
    }

    return {
      ok: true,
      transportMode: 'plaintext',
      commandHash: hashCommand(input.command),
      dialect: input.dialect,
      platform: input.platform,
      environmentEpoch: input.environmentEpoch,
      wrappedCommand,
    };
  }

  /**
   * Prepare and write the plaintext command to the PTY.
   */
  async execute(input: PlaintextDispatchInput): Promise<PlaintextDispatchExecutionResult> {
    const prepared = this.prepare(input);
    if (!prepared.ok) return prepared;

    const writeResult = await writeToPty(
      this.#actor,
      {
        taskId: input.taskId,
        leaseEpoch: input.leaseEpoch,
      },
      prepared.wrappedCommand,
    );

    return { ...prepared, writeResult };
  }

  /**
   * Dispatch only one of the built-in, side-effect-free environment probes.
   * This is the sole pre-verification write path and deliberately has no
   * caller-provided command field.
   */
  async executeProbe(input: PlaintextProbeDispatchInput): Promise<PlaintextProbeDispatchResult> {
    if (!isSafeProbeNonce(input.nonce)) {
      return this.#protocolError('Probe nonce contains unsupported characters');
    }

    let payload: string;
    if (input.kind === 'environment_fingerprint') {
      payload = buildFingerprintPayload(input.nonce);
    } else {
      if (input.dialect === undefined) {
        return this.#protocolError('Capability probe requires a shell dialect');
      }
      try {
        payload = resolveShellDriver(input.dialect).buildProbe(input.nonce);
      } catch (error) {
        return this.#protocolError(
          error instanceof Error ? error.message : 'Failed to construct capability probe',
        );
      }
    }

    if (shellInputLines(payload).length !== 1) {
      return this.#protocolError('Built-in probe must be sent as one physical PTY input line');
    }

    const writeResult = await writeToPty(this.#actor, input, payload);
    if (!writeResult.ok) {
      return this.#protocolError(`PTY write rejected: ${writeResult.error}`);
    }
    return { ok: true, kind: input.kind, payload, writeResult };
  }

  #protocolError(message: string): PlaintextDispatchError {
    return { ok: false, errorCode: 'plaintext_protocol_error', message };
  }
}

async function writeToPty(
  actor: SessionActor,
  writeInput: Pick<AgentWriteInput, 'taskId' | 'leaseEpoch'>,
  payload: string,
): Promise<Awaited<ReturnType<SessionActor['writeAgent']>>> {
  const lines = shellInputLines(payload);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const result = await actor.writeAgent({
      taskId: writeInput.taskId,
      leaseEpoch: writeInput.leaseEpoch,
      data: `${line}\r`,
    });
    if (!result.ok) return result;
    if (index < lines.length - 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  return { ok: true };
}

function buildFingerprintPayload(nonce: string): string {
  return `echo __TA_DIALECT_${nonce}__:\${0}:\${PSVersionTable}`;
}

function isSafeTransactionNonce(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9./-]{0,127}$/.test(value);
}

function isSafeProbeNonce(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(value);
}
