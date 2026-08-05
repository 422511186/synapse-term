import { SecretRedactor, summarizeAuditPath, type AuditEvent } from '@synapse-term/infrastructure';

export type AuditOutcome =
  'in_progress' | 'success' | 'failure' | 'rejected' | 'interrupted' | 'information';

export type AuditRisk = 'read_only' | 'unknown' | 'mutating' | 'privileged' | 'destructive';

export type AuditSubject = 'agent_task' | 'external_transaction' | 'event';

export type AuditCategory =
  'command' | 'approval' | 'file' | 'session' | 'configuration' | 'external' | 'observation';

export interface AuditActorView {
  kind: AuditEvent['actor']['kind'];
  taskId?: string;
  callerKind?: 'mcp' | 'acp';
  callerId?: string;
}

export interface AuditTraceFieldView {
  label: string;
  value: string;
}

export interface AuditTraceEventView {
  id: string;
  type: string;
  occurredAt: string;
  sessionId?: string;
  taskId?: string;
  transactionId?: string;
  actor: AuditActorView;
  category: AuditCategory;
  outcome: AuditOutcome;
  risk: AuditRisk;
  summary: string;
  commandPreview?: string;
  pathPreview?: string;
  commandHash?: string;
  authorization?: string;
  policy?: string;
  approval?: string;
  exitCode?: number;
  reason?: string;
  details?: AuditTraceFieldView[];
}

export interface AuditTraceView {
  traceId: string;
  subject: AuditSubject;
  sessionId?: string;
  taskId?: string;
  transactionId?: string;
  actor: AuditActorView;
  category: AuditCategory;
  startedAt: string;
  lastActivityAt: string;
  outcome: AuditOutcome;
  risk: AuditRisk;
  summary: string;
  eventCount: number;
  containsObservations: boolean;
}

export interface AuditTraceDetailView extends AuditTraceView {
  events: AuditTraceEventView[];
}

const RISK_ORDER: readonly AuditRisk[] = [
  'read_only',
  'unknown',
  'mutating',
  'privileged',
  'destructive',
];

const CATEGORY_ORDER: readonly AuditCategory[] = [
  'command',
  'approval',
  'file',
  'external',
  'configuration',
  'session',
  'observation',
];
const MAX_AUDIT_TEXT_LENGTH = 4_096;

const OBSERVATION_TYPES = new Set([
  'external.observe',
  'external.status',
  'session.probe',
  'session.resources_refreshed',
  'session.resources_failed',
  // 用户直接向 PTY 输入的内容只记录字节数，既不能还原命令，也会淹没真正的执行证据。
  'session.input',
]);
const projectionRedactor = new SecretRedactor();

export function projectAuditEvents(
  events: readonly AuditEvent[],
  options: { includeObservations?: boolean | undefined } = {},
): AuditTraceView[] {
  const groups = new Map<string, AuditEvent[]>();
  for (const event of events) {
    if (!options.includeObservations && isSuccessfulObservation(event)) continue;
    const key = auditTraceId(event);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [event]);
    else group.push(event);
  }

  return [...groups.entries()]
    .map(([traceId, grouped]) => projectTrace(traceId, grouped))
    .sort(
      (left, right) =>
        right.lastActivityAt.localeCompare(left.lastActivityAt) ||
        right.traceId.localeCompare(left.traceId),
    );
}

export function projectAuditTrace(
  events: readonly AuditEvent[],
  traceId: string,
  options: { includeObservations?: boolean | undefined } = {},
): AuditTraceDetailView | undefined {
  const grouped = events.filter(
    (event) =>
      (options.includeObservations || !isSuccessfulObservation(event)) &&
      auditTraceId(event) === traceId,
  );
  if (grouped.length === 0) return undefined;
  const summary = projectTrace(traceId, grouped);
  return {
    ...summary,
    events: [...grouped].sort(compareEvents).map(projectEvent),
  };
}

function projectTrace(traceId: string, events: readonly AuditEvent[]): AuditTraceView {
  const ordered = [...events].sort(compareEvents);
  const first = ordered[0]!;
  const last = ordered.at(-1)!;
  const eventViews = ordered.map(projectEvent);
  const firstTransactionId = eventViews.find((event) => event.transactionId)?.transactionId;
  const categoryEvent = [...eventViews].sort(
    (left, right) => categoryRank(left.category) - categoryRank(right.category),
  )[0]!;
  const subject = traceId.startsWith('task:')
    ? 'agent_task'
    : traceId.startsWith('transaction:')
      ? 'external_transaction'
      : 'event';
  const taskId = traceId.startsWith('task:') ? traceId.slice('task:'.length) : first.taskId;
  const transactionId = traceId.startsWith('transaction:')
    ? traceId.slice('transaction:'.length)
    : firstTransactionId;
  const summary = traceSummary(eventViews);
  return {
    traceId,
    subject,
    ...(first.sessionId === undefined ? {} : { sessionId: first.sessionId }),
    ...(taskId === undefined ? {} : { taskId }),
    ...(transactionId === undefined ? {} : { transactionId }),
    actor: projectActor(first.actor),
    category: categoryEvent.category,
    startedAt: first.occurredAt,
    lastActivityAt: last.occurredAt,
    outcome: normalizeTraceOutcome(eventViews.map((event) => event.outcome)),
    risk: highestRisk(eventViews.map((event) => event.risk)),
    summary,
    eventCount: events.length,
    containsObservations: eventViews.some((event) => event.category === 'observation'),
  };
}

function traceSummary(events: readonly AuditTraceEventView[]): string {
  const command = [...events].reverse().find((event) => event.commandPreview !== undefined);
  if (command?.commandPreview !== undefined) return `命令：${command.commandPreview}`;

  const path = [...events].reverse().find((event) => event.pathPreview !== undefined);
  if (path?.pathPreview !== undefined) return `路径：${path.pathPreview}`;

  const failure = [...events].reverse().find((event) => event.reason !== undefined);
  if (failure?.reason !== undefined) return `原因：${failure.reason}`;

  return events.at(-1)?.summary ?? events.at(-1)?.type ?? '未记录事件';
}

function projectEvent(event: AuditEvent): AuditTraceEventView {
  const payload = event.payload;
  const transactionId = stringValue(payload.transactionId);
  const commandPreview = redactProjectionText(payload.commandPreview);
  const rawPathPreview = stringValue(payload.pathPreview) ?? stringValue(payload.path);
  const pathPreview =
    rawPathPreview === undefined
      ? undefined
      : summarizeAuditPath(rawPathPreview, projectionRedactor);
  const commandHash = stringValue(payload.commandHash);
  const reason = redactProjectionText(payload.reason) ?? redactProjectionText(payload.error);
  const status = redactProjectionText(payload.status);
  const authorization = projectField([['authorization', payload.authorization]]);
  const policy = projectField([
    ['policy', payload.policy],
    ['permissionMode', payload.permissionMode],
  ]);
  const approval = projectField([
    ['approval', payload.approval],
    ['approvalMode', payload.approvalMode],
    ['approvalId', payload.approvalId],
    ['approvalGrantId', payload.approvalGrantId],
    ['grantId', payload.grantId],
  ]);
  const summary = commandPreview ?? pathPreview ?? reason ?? commandHash ?? status ?? event.type;
  const details = projectDetails(payload);
  return {
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt,
    ...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }),
    ...(event.taskId === undefined ? {} : { taskId: event.taskId }),
    ...(transactionId === undefined ? {} : { transactionId }),
    actor: projectActor(event.actor),
    category: categoryFor(event.type),
    outcome: normalizeEventOutcome(event),
    risk: riskFor(payload),
    summary,
    ...(commandPreview === undefined ? {} : { commandPreview }),
    ...(pathPreview === undefined ? {} : { pathPreview }),
    ...(commandHash === undefined ? {} : { commandHash }),
    ...(authorization === undefined ? {} : { authorization }),
    ...(policy === undefined ? {} : { policy }),
    ...(approval === undefined ? {} : { approval }),
    ...(typeof payload.exitCode === 'number' ? { exitCode: payload.exitCode } : {}),
    ...(reason === undefined ? {} : { reason }),
    ...(details.length === 0 ? {} : { details }),
  };
}

function auditTraceId(event: AuditEvent): string {
  if (event.taskId !== undefined && event.taskId.length > 0) return `task:${event.taskId}`;
  if (isExternalTransactionEvent(event)) {
    const transactionId = stringValue(event.payload.transactionId);
    if (transactionId !== undefined && transactionId.length > 0)
      return `transaction:${transactionId}`;
  }
  return `event:${event.id}`;
}

function isExternalTransactionEvent(event: AuditEvent): boolean {
  return (
    event.type === 'external.command' ||
    event.type === 'external.wait' ||
    event.type === 'external.interrupt'
  );
}

function isSuccessfulObservation(event: AuditEvent): boolean {
  if (!isObservationType(event.type)) return false;
  const outcome = normalizeEventOutcome(event);
  return outcome === 'success' || outcome === 'information';
}

function isObservationType(type: string): boolean {
  return OBSERVATION_TYPES.has(type) || type.startsWith('session.resources');
}

function categoryFor(type: string): AuditCategory {
  if (
    type.startsWith('command.') ||
    type === 'external.command' ||
    type === 'external.wait' ||
    type === 'external.interrupt'
  )
    return 'command';
  if (type.startsWith('approval.') || type === 'tool.authorization') return 'approval';
  if (type.startsWith('file.') || type.startsWith('external.file.')) return 'file';
  if (isObservationType(type) || type.includes('resources')) return 'observation';
  if (type.startsWith('session.')) return 'session';
  if (
    type.startsWith('provider.') ||
    type.startsWith('model.') ||
    type.startsWith('configuration.')
  )
    return 'configuration';
  if (type.startsWith('external.')) return 'external';
  return 'configuration';
}

function normalizeEventOutcome(event: AuditEvent): AuditOutcome {
  const status = (
    stringValue(event.payload.status) ?? stringValue(event.payload.outcome)
  )?.toLowerCase();
  if (
    event.type === 'external.denied' ||
    event.type.endsWith('.rejected') ||
    event.type === 'approval.rejected'
  )
    return 'rejected';
  const commandLifecycle = event.type.startsWith('command.')
    ? event.type.slice('command.'.length)
    : undefined;
  if (commandLifecycle === 'completed') return 'success';
  if (commandLifecycle === 'running' || commandLifecycle === 'interaction_required') {
    return 'in_progress';
  }
  if (commandLifecycle === 'shell_lost' || commandLifecycle === 'protocol_error') {
    return 'failure';
  }
  if (
    event.type.includes('interrupt') ||
    event.type.includes('takeover') ||
    status === 'interrupted' ||
    status === 'cancelled' ||
    status === 'shell_lost'
  )
    return 'interrupted';
  if (
    event.type.endsWith('.failed') ||
    event.type.endsWith('_failed') ||
    stringValue(event.payload.error) !== undefined ||
    status === 'failed' ||
    status === 'failure' ||
    status === 'error' ||
    status === 'protocol_error' ||
    (typeof event.payload.exitCode === 'number' && event.payload.exitCode !== 0)
  )
    return 'failure';
  if (
    status === 'running' ||
    status === 'started' ||
    status === 'pending' ||
    status === 'requested' ||
    status === 'waiting'
  )
    return 'in_progress';
  if (
    status === 'completed' ||
    status === 'complete' ||
    status === 'partial' ||
    status === 'success' ||
    status === 'succeeded' ||
    status === 'ready'
  )
    return 'success';
  return 'information';
}

function normalizeTraceOutcome(outcomes: readonly AuditOutcome[]): AuditOutcome {
  if (outcomes.includes('rejected')) return 'rejected';
  if (outcomes.includes('failure')) return 'failure';
  if (outcomes.includes('interrupted')) return 'interrupted';
  if (outcomes.includes('success')) return 'success';
  if (outcomes.includes('in_progress')) return 'in_progress';
  return 'information';
}

function projectActor(actor: AuditEvent['actor']): AuditActorView {
  return {
    kind: actor.kind,
    ...('taskId' in actor ? { taskId: actor.taskId } : {}),
    ...('callerKind' in actor ? { callerKind: actor.callerKind } : {}),
    ...('callerId' in actor ? { callerId: actor.callerId } : {}),
  };
}

function riskFor(payload: Record<string, unknown>): AuditRisk {
  const value = stringValue(payload.risk);
  return value !== undefined && RISK_ORDER.includes(value as AuditRisk)
    ? (value as AuditRisk)
    : 'unknown';
}

function highestRisk(risks: readonly AuditRisk[]): AuditRisk {
  return risks.reduce(
    (highest, risk) => (RISK_ORDER.indexOf(risk) > RISK_ORDER.indexOf(highest) ? risk : highest),
    'read_only' as AuditRisk,
  );
}

function categoryRank(category: AuditCategory): number {
  return CATEGORY_ORDER.indexOf(category);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function redactProjectionText(value: unknown): string | undefined {
  const text = stringValue(value);
  return text === undefined ? undefined : boundAuditText(projectionRedactor.redact(text).text);
}

function projectField(entries: readonly [label: string, value: unknown][]): string | undefined {
  const values = entries.flatMap(([label, value]) => {
    const text = redactProjectionText(value);
    return text === undefined ? [] : [[label, text] as const];
  });
  if (values.length === 0) return undefined;
  if (values.length === 1) return values[0]![1];
  return boundAuditText(values.map(([label, value]) => `${label}=${value}`).join('; '));
}

const DETAIL_DEFINITIONS: readonly {
  label: string;
  keys: readonly string[];
}[] = [
  { label: '模型配置', keys: ['modelConfigurationId'] },
  { label: 'Provider', keys: ['providerProfileId', 'providerId'] },
  { label: '模型 ID', keys: ['modelId'] },
  { label: 'Conversation', keys: ['conversationId'] },
  { label: '工具', keys: ['tool'] },
  { label: '来源', keys: ['source'] },
  { label: '来源类型', keys: ['sourceKind'] },
  { label: '传输方式', keys: ['transportMode'] },
  { label: '执行方言', keys: ['executionDialect'] },
  { label: '执行状态', keys: ['status', 'outcome'] },
  { label: '查看方式', keys: ['view'] },
  { label: '操作', keys: ['operation'] },
  { label: '截至序列', keys: ['throughSequence'] },
  { label: '来源条数', keys: ['sourceItemCount'] },
  { label: '压缩前 Token', keys: ['estimatedTokensBefore'] },
  { label: '摘要方式', keys: ['summaryMethod'] },
  { label: '策略原因', keys: ['reasons'] },
];

function projectDetails(payload: Record<string, unknown>): AuditTraceFieldView[] {
  return DETAIL_DEFINITIONS.flatMap(({ label, keys }) => {
    const value = keys
      .map((key) => displayAuditValue(payload[key]))
      .find((item): item is string => item !== undefined);
    return value === undefined ? [] : [{ label, value }];
  });
}

function displayAuditValue(value: unknown): string | undefined {
  if (typeof value === 'string') return redactProjectionText(value);
  if (typeof value === 'number' || typeof value === 'boolean') {
    return redactProjectionText(String(value));
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return redactProjectionText(value.join('；'));
  }
  return undefined;
}

function boundAuditText(value: string): string {
  if (value.length <= MAX_AUDIT_TEXT_LENGTH) return value;
  return `${value.slice(0, MAX_AUDIT_TEXT_LENGTH - 1)}…`;
}

function compareEvents(left: AuditEvent, right: AuditEvent): number {
  return left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id);
}
