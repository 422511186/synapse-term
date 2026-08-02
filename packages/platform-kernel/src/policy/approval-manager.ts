import { randomUUID } from 'node:crypto';

import {
  createApprovalGrant,
  hashCommand,
  matchesApprovalGrant,
  type ApprovalCandidate,
  type ApprovalGrant,
  type ApprovalScope,
  type CommandRisk,
} from '@synapse-term/domain';

export { hashCommand } from '@synapse-term/domain';

export interface ApprovalClock {
  now(): Date;
}

export interface ApprovalCommandInput {
  command: string;
  level: CommandRisk;
  reasons: readonly string[];
}

export interface CreateApprovalGrantInput {
  id?: string;
  sessionId: string;
  taskId: string;
  environmentEpoch?: number;
  scope?: ApprovalScope;
  commands: readonly ApprovalCommandInput[];
  expiresAt?: string;
}

export type ApprovalValidation =
  { ok: true } | { ok: false; error: 'approval_invalid' | 'approval_expired' };

const systemClock: ApprovalClock = { now: () => new Date() };

export class ApprovalManager {
  readonly #clock: ApprovalClock;

  constructor(options: { now?: () => Date } = {}) {
    this.#clock = options.now === undefined ? systemClock : { now: options.now };
  }

  createGrant(input: CreateApprovalGrantInput): ApprovalGrant {
    if (input.commands.length === 0)
      throw new RangeError('approval grant needs at least one command');
    if (
      input.commands.some((command) => command.level === 'destructive') &&
      input.commands.length !== 1
    ) {
      throw new Error('destructive approval must contain exactly one command');
    }
    const commands = input.commands.map((command, sequence) => ({
      sequence,
      command: command.command,
      commandHash: hashCommand(command.command),
      risk: { level: command.level, reasons: [...command.reasons] },
    }));
    return createApprovalGrant({
      id: input.id ?? randomUUID(),
      sessionId: input.sessionId,
      taskId: input.taskId,
      ...(input.environmentEpoch === undefined ? {} : { environmentEpoch: input.environmentEpoch }),
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      commands,
      grantedAt: this.#clock.now().toISOString(),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    });
  }

  validate(grant: ApprovalGrant, candidate: ApprovalCandidate): ApprovalValidation {
    if (
      grant.expiresAt !== undefined &&
      this.#clock.now().getTime() >= Date.parse(grant.expiresAt)
    ) {
      return { ok: false, error: 'approval_expired' };
    }
    if (
      candidate.commands.some((command) => command.commandHash !== hashCommand(command.command)) ||
      !matchesApprovalGrant(grant, candidate)
    ) {
      return { ok: false, error: 'approval_invalid' };
    }
    return { ok: true };
  }
}
