import { createHash, randomUUID } from 'node:crypto';

import type { CommandRisk } from '@synapse-term/domain';

import { hashCommand } from '@synapse-term/domain';
import { SecretRedactor } from '../security/secret-protection.js';
import type {
  AuditEvent,
  AuditEventPage,
  AuditEventPageFilter,
  CoreRepositories,
} from '../store/repositories.js';

export interface AuditActor {
  kind: 'user' | 'system' | 'agent' | 'external';
  taskId?: string;
  /** 外部调用者身份（specs/mcp-access、ADR-0024）：来源 + id，不伪造 Task/Turn */
  callerKind?: 'mcp' | 'acp';
  callerId?: string;
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
  readonly #repositories: Pick<CoreRepositories, 'appendAuditEvent' | 'listAuditEvents'> &
    Partial<Pick<CoreRepositories, 'listAuditEventsPage'>>;
  readonly #now: () => Date;
  readonly #redactor: SecretRedactor;

  constructor(
    repositories: Pick<CoreRepositories, 'appendAuditEvent' | 'listAuditEvents'> &
      Partial<Pick<CoreRepositories, 'listAuditEventsPage'>>,
    options: { now?: () => Date; redactor?: SecretRedactor } = {},
  ) {
    this.#repositories = repositories;
    this.#now = options.now ?? (() => new Date());
    this.#redactor = options.redactor ?? new SecretRedactor();
  }

  record(input: AuditRecordInput): void {
    this.#repositories.appendAuditEvent({
      id: input.id ?? randomUUID(),
      actor: normalizeActor(input.actor),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      type: input.type,
      occurredAt: input.occurredAt ?? this.#now().toISOString(),
      payload: redactAuditPayload(input.payload, this.#redactor),
    });
  }

  recordCommand(input: AuditCommandInput): void {
    const commandPreview = this.#redactor.redact(input.command).text;
    this.record({
      ...(input.id === undefined ? {} : { id: input.id }),
      actor: input.actor,
      sessionId: input.sessionId,
      taskId: input.taskId,
      type: `command.${input.status}`,
      payload: {
        commandPreview,
        commandHash: input.commandHash ?? hashCommand(input.command),
        risk: input.risk,
        status: input.status,
        ...(input.grantId === undefined ? {} : { grantId: input.grantId }),
        ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
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

  listEvents(filter: AuditEventPageFilter = {}): AuditEventPage {
    if (this.#repositories.listAuditEventsPage !== undefined) {
      return this.#repositories.listAuditEventsPage(filter);
    }
    const events = this.#repositories.listAuditEvents().filter((event) => {
      if (filter.from !== undefined && event.occurredAt < filter.from) return false;
      if (filter.to !== undefined && event.occurredAt > filter.to) return false;
      if (filter.sessionId !== undefined && event.sessionId !== filter.sessionId) return false;
      if (filter.taskId !== undefined && event.taskId !== filter.taskId) return false;
      return true;
    });
    const limit = filter.limit ?? 200;
    return { items: events.slice(0, limit) };
  }
}

function redactAuditPayload(
  value: Record<string, unknown>,
  redactor: SecretRedactor,
): Record<string, unknown> {
  return redactAuditValue(value, redactor) as Record<string, unknown>;
}

function redactAuditValue(value: unknown, redactor: SecretRedactor, key?: string): unknown {
  if (typeof value === 'string') {
    return key === 'path' || key === 'pathPreview'
      ? summarizeAuditPath(value, redactor)
      : redactor.redact(value).text;
  }
  if (Array.isArray(value)) return value.map((item) => redactAuditValue(item, redactor));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !AUDIT_PAYLOAD_EXCLUDED_KEYS.has(key))
      .map(([key, item]) => [key, redactAuditValue(item, redactor, key)]),
  );
}

/**
 * Paths can identify a user's home directory or a sensitive file even when
 * they contain no token-like secret. Keep a stable shape and digest for
 * diagnostics, without retaining any original path segment.
 */
export function summarizeAuditPath(value: string, redactor: SecretRedactor): string {
  if (value.startsWith('[audit-path:')) return value;
  const redacted = redactor.redact(value);
  if (redacted.detectorError) return redacted.text;
  const normalized = redacted.text.replaceAll('\\', '/');
  const kind = /^(?:[A-Za-z]:\/|\/|\/\/)/.test(normalized) ? 'absolute' : 'relative';
  const segmentCount = normalized.split('/').filter((segment) => segment.length > 0).length;
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  return `[audit-path:${kind};segments=${segmentCount};hash=${digest}]`;
}

const AUDIT_PAYLOAD_EXCLUDED_KEYS = new Set([
  'output',
  'screen',
  'terminalOutput',
  'recording',
  'transcript',
  'protectedInput',
]);

function normalizeActor(actor: AuditActor): AuditEvent['actor'] {
  if (actor.kind === 'agent') {
    if (actor.taskId === undefined) throw new Error('agent audit actor needs taskId');
    return { kind: 'agent', taskId: actor.taskId };
  }
  if (actor.kind === 'external') {
    if (actor.callerKind === undefined || actor.callerId === undefined) {
      throw new Error('external audit actor needs callerKind and callerId');
    }
    return { kind: 'external', callerKind: actor.callerKind, callerId: actor.callerId };
  }
  return { kind: actor.kind };
}
