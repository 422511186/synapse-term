import { randomUUID } from 'node:crypto';

import type { CommandRisk } from '@terminal-agent/domain';

import { hashCommand } from './approval-manager.js';
import { SecretRedactor } from './secret-protection.js';
import type { AuditEvent, CoreRepositories } from './repositories.js';

export interface AuditActor {
  kind: 'user' | 'system' | 'agent';
  taskId?: string;
}

export interface AuditRecordInput {
  id?: string;
  actor: AuditActor;
  sessionId?: string;
  taskId?: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt?: string;
}

export interface AuditCommandInput {
  id?: string;
  actor: AuditActor;
  sessionId: string;
  taskId: string;
  command: string;
  risk: CommandRisk;
  grantId?: string;
  status: string;
  exitCode?: number;
  reason?: string;
  output?: string;
  transportMode?: string;
  sourceKind?: string;
  executionDialect?: string;
  environmentEpoch?: number;
  commandHash?: string;
}

export class AuditService {
  readonly #repositories: Pick<CoreRepositories, 'appendAuditEvent' | 'listAuditEvents'>;
  readonly #now: () => Date;
  readonly #redactor: SecretRedactor;

  constructor(
    repositories: Pick<CoreRepositories, 'appendAuditEvent' | 'listAuditEvents'>,
    options: { now?: () => Date; redactor?: SecretRedactor } = {},
  ) {
    this.#repositories = repositories;
    this.#now = options.now ?? (() => new Date());
    this.#redactor = options.redactor ?? new SecretRedactor();
  }

  record(input: AuditRecordInput): void {
    const redacted = this.#redactor.redact(JSON.stringify(input.payload));
    this.#repositories.appendAuditEvent({
      id: input.id ?? randomUUID(),
      actor: normalizeActor(input.actor),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      type: input.type,
      occurredAt: input.occurredAt ?? this.#now().toISOString(),
      payload: redacted.redacted ? { redacted: redacted.text } : input.payload,
    });
  }

  recordCommand(input: AuditCommandInput): void {
    this.record({
      ...(input.id === undefined ? {} : { id: input.id }),
      actor: input.actor,
      sessionId: input.sessionId,
      taskId: input.taskId,
      type: `command.${input.status}`,
      payload: {
        commandHash: input.commandHash ?? hashCommand(input.command),
        risk: input.risk,
        ...(input.grantId === undefined ? {} : { grantId: input.grantId }),
        ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        ...(input.output === undefined ? {} : { output: input.output }),
        ...(input.transportMode === undefined ? {} : { transportMode: input.transportMode }),
        ...(input.sourceKind === undefined ? {} : { sourceKind: input.sourceKind }),
        ...(input.executionDialect === undefined
          ? {}
          : { executionDialect: input.executionDialect }),
        ...(input.environmentEpoch === undefined
          ? {}
          : { environmentEpoch: input.environmentEpoch }),
      },
    });
  }

  query(filter: { sessionId?: string; taskId?: string; type?: string } = {}): AuditEvent[] {
    return this.#repositories.listAuditEvents().filter((event) => {
      if (filter.sessionId !== undefined && event.sessionId !== filter.sessionId) return false;
      if (filter.taskId !== undefined && event.taskId !== filter.taskId) return false;
      if (filter.type !== undefined && event.type !== filter.type) return false;
      return true;
    });
  }
}

function normalizeActor(actor: AuditActor): AuditEvent['actor'] {
  if (actor.kind === 'agent') {
    if (actor.taskId === undefined) throw new Error('agent audit actor needs taskId');
    return { kind: 'agent', taskId: actor.taskId };
  }
  return { kind: actor.kind };
}
