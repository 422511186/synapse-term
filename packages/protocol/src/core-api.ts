import { z } from 'zod';

import {
  commandRiskSchema,
  agentConversationSchema,
  agentTurnSchema,
  modelItemSchema,
  permissionModeSchema,
  reasoningEffortSchema,
} from './domain-schemas.js';

const idSchema = z.string().min(1);
const emptyPayloadSchema = z.strictObject({});
const providerProtocolSchema = z.enum([
  'openai_responses',
  'openai_chat_completions',
  'anthropic_messages',
]);
const executionDialectSchema = z.enum(['posix', 'powershell', 'observe_only']);
const terminalTypeSchema = z.string().trim().min(1).max(128);

export const sessionSummarySchema = z.strictObject({
  id: idSchema,
  title: z.string().min(1),
  terminalType: terminalTypeSchema,
  pty: z.enum(['starting', 'running', 'exited', 'failed', 'interrupted']),
  shell: z.enum(['unknown', 'probing', 'ready', 'executing', 'interaction_required']),
  executionDialect: executionDialectSchema.default('observe_only'),
  agentStatus: z.string().min(1).optional(),
});

export const sessionLaunchSchema = z.strictObject({
  title: z.string().min(1),
  terminalType: terminalTypeSchema,
  executable: z.string().min(1),
  args: z.array(z.string()).max(256),
  cwd: z.string().min(1),
  env: z.record(z.string(), z.string()),
  columns: z.number().int().positive().max(1_000),
  rows: z.number().int().positive().max(1_000),
  executionDialect: executionDialectSchema.default('observe_only'),
});

export const sessionLaunchMetadataSchema = z.strictObject({
  title: z.string().min(1),
  launch: z.strictObject({
    executable: z.string().min(1),
    terminalType: terminalTypeSchema.default('Unknown terminal'),
    args: z.array(z.string()).max(256),
    cwd: z.string().min(1),
    columns: z.number().int().positive().max(1_000),
    rows: z.number().int().positive().max(1_000),
    executionDialect: executionDialectSchema.default('observe_only'),
    envKeys: z.array(z.string().min(1)).max(4_096),
  }),
});

export const terminalReplaySchema = z.strictObject({
  historyGap: z.boolean(),
  snapshot: z.string().optional(),
  events: z.array(
    z.strictObject({
      sequence: z.number().int().nonnegative(),
      data: z.string(),
    }),
  ),
  oldestSequence: z.number().int().nonnegative().optional(),
  nextSequence: z.number().int().nonnegative(),
});

export const localFileChangeSchema = z.strictObject({
  path: z.string().min(1),
  operation: z.enum(['create', 'replace', 'edit']),
  beforeSha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
  afterSha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  bytes: z.number().int().nonnegative(),
  diff: z.string(),
  truncated: z.boolean(),
});

export const agentTimelineItemSchema = z.strictObject({
  id: idSchema,
  sessionId: idSchema,
  kind: z.enum(['user', 'assistant', 'tool', 'command', 'file', 'approval', 'system']),
  text: z.string(),
  status: z.string().min(1).optional(),
  toolRole: z.enum(['call', 'result']).optional(),
  conversationId: idSchema.optional(),
  turnId: idSchema.optional(),
  toolCallId: idSchema.optional(),
  risk: commandRiskSchema.optional(),
  reasons: z.array(z.string().min(1)).max(32).optional(),
  change: localFileChangeSchema.optional(),
  occurredAt: z.string().datetime({ offset: true }),
});

export const agentHistoryViewSchema = z.strictObject({
  sessionId: idSchema,
  conversation: agentConversationSchema.optional(),
  turns: z.array(agentTurnSchema),
  items: z.array(modelItemSchema),
  activeTurnId: idSchema.optional(),
});

const resourceUnavailableReasonSchema = z.enum([
  'not_reported',
  'command_unavailable',
  'invalid_output',
]);
const resourceSnapshotStatusSchema = z.enum(['complete', 'partial', 'unavailable']);
const resourceDialectSchema = z.enum(['posix', 'powershell']);
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const percentageSchema = z.number().min(0).max(100);

function resourceMetricSchema<T extends z.ZodType>(valueSchema: T) {
  return z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('available'), value: valueSchema }),
    z.strictObject({
      status: z.literal('unavailable'),
      reason: resourceUnavailableReasonSchema,
      message: z.string().min(1).max(4_096),
    }),
  ]);
}

const hostResourceSchema = z.strictObject({ name: z.string().min(1).max(4_096) });
const operatingSystemResourceSchema = z.strictObject({
  name: z.string().min(1).max(4_096),
  version: z.string().min(1).max(4_096).optional(),
  architecture: z.string().min(1).max(4_096).optional(),
});
const uptimeResourceSchema = z.strictObject({ seconds: nonNegativeIntegerSchema });
const loadAverageResourceSchema = z.strictObject({
  oneMinute: z.number().nonnegative(),
  fiveMinutes: z.number().nonnegative(),
  fifteenMinutes: z.number().nonnegative(),
});
const cpuResourceSchema = z
  .strictObject({
    logicalProcessors: z.number().int().positive().optional(),
    usagePercent: percentageSchema.optional(),
    loadAverage: loadAverageResourceSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'CPU metric must contain a value');
const memoryResourceSchema = z
  .strictObject({
    totalBytes: nonNegativeIntegerSchema,
    usedBytes: nonNegativeIntegerSchema,
    availableBytes: nonNegativeIntegerSchema.optional(),
  })
  .refine((value) => value.usedBytes <= value.totalBytes, 'usedBytes exceeds totalBytes');
const diskResourceSchema = z
  .strictObject({
    name: z.string().min(1).max(4_096),
    mountPoint: z.string().min(1).max(4_096).optional(),
    totalBytes: nonNegativeIntegerSchema,
    usedBytes: nonNegativeIntegerSchema,
    availableBytes: nonNegativeIntegerSchema.optional(),
    usagePercent: percentageSchema.optional(),
  })
  .refine((value) => value.usedBytes <= value.totalBytes, 'usedBytes exceeds totalBytes');
const networkResourceSchema = z.strictObject({
  name: z.string().min(1).max(4_096),
  receivedBytes: nonNegativeIntegerSchema,
  transmittedBytes: nonNegativeIntegerSchema,
});

export const sessionResourceSnapshotSchema = z
  .strictObject({
    dialect: resourceDialectSchema,
    collectedAt: z.string().datetime({ offset: true }),
    status: resourceSnapshotStatusSchema,
    host: resourceMetricSchema(hostResourceSchema),
    os: resourceMetricSchema(operatingSystemResourceSchema),
    uptime: resourceMetricSchema(uptimeResourceSchema),
    cpu: resourceMetricSchema(cpuResourceSchema),
    memory: resourceMetricSchema(memoryResourceSchema),
    swap: resourceMetricSchema(memoryResourceSchema),
    disks: resourceMetricSchema(z.array(diskResourceSchema).max(32)),
    network: resourceMetricSchema(z.array(networkResourceSchema).max(32)),
  })
  .superRefine((snapshot, context) => {
    const metrics = [
      snapshot.host,
      snapshot.os,
      snapshot.uptime,
      snapshot.cpu,
      snapshot.memory,
      snapshot.swap,
      snapshot.disks,
      snapshot.network,
    ];
    const available = metrics.filter((metric) => metric.status === 'available').length;
    const expected =
      available === metrics.length ? 'complete' : available === 0 ? 'unavailable' : 'partial';
    if (snapshot.status !== expected) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: `Resource snapshot status must be ${expected}`,
      });
    }
  });

export const sessionResourceRefreshErrorSchema = z.strictObject({
  code: z.enum([
    'session_not_found',
    'session_not_ready',
    'execution_dialect_unsupported',
    'lease_unavailable',
    'collection_timeout',
    'collection_failed',
  ]),
  message: z.string().min(1).max(4_096),
});

export const sessionResourceRefreshResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), snapshot: sessionResourceSnapshotSchema }),
  z.strictObject({ ok: z.literal(false), error: sessionResourceRefreshErrorSchema }),
]);

const modelReasoningEffortsSchema = z
  .array(reasoningEffortSchema)
  .min(1)
  .max(4)
  .refine((efforts) => new Set(efforts).size === efforts.length, {
    message: 'Reasoning efforts must be unique',
  });

const providerProfileBaseShape = {
  id: idSchema,
  name: z.string().min(1),
  protocol: providerProtocolSchema,
  baseUrl: z.string().min(1),
  extraHeaders: z.record(z.string(), z.string()).optional(),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(10 * 60 * 1_000)
    .optional(),
};

export const providerProfileInputSchema = z.strictObject(providerProfileBaseShape);

export const providerProfileViewSchema = z.strictObject({
  ...providerProfileBaseShape,
  credentialConfigured: z.boolean(),
  revision: z.number().int().nonnegative(),
});

const modelConfigurationBaseShape = {
  id: idSchema,
  name: z.string().min(1),
  providerProfileId: idSchema,
  modelId: z.string().min(1),
  contextWindowTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  autoCompact: z.boolean(),
  compactThresholdPercent: z.number().int().min(50).max(95),
  supportedReasoningEfforts: modelReasoningEffortsSchema,
  defaultReasoningEffort: reasoningEffortSchema,
  declaredCapabilities: z.strictObject({
    responses: z.boolean(),
    streaming: z.boolean(),
    toolCalls: z.boolean(),
    reasoning: z.boolean().optional(),
  }),
};

export const modelConfigurationInputSchema = z
  .strictObject(modelConfigurationBaseShape)
  .superRefine(validateModelConfiguration);

const modelValidationViewSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unverified') }),
  z.strictObject({ status: z.literal('validating'), attempt: z.number().int().positive() }),
  z.strictObject({
    status: z.literal('available'),
    checkedAt: z.string().datetime({ offset: true }),
    attempt: z.number().int().positive(),
    capabilities: modelConfigurationBaseShape.declaredCapabilities,
  }),
  z.strictObject({
    status: z.literal('unavailable'),
    checkedAt: z.string().datetime({ offset: true }),
    attempt: z.number().int().positive(),
    reason: z.string().min(1),
  }),
]);

export const modelConfigurationViewSchema = z
  .strictObject({
    ...modelConfigurationBaseShape,
    providerName: z.string().min(1),
    providerProtocol: providerProtocolSchema,
    enabled: z.boolean(),
    isDefault: z.boolean(),
    status: z.enum(['unverified', 'validating', 'available', 'unavailable']),
    validation: modelValidationViewSchema,
    revision: z.number().int().nonnegative(),
  })
  .superRefine(validateModelConfiguration);

function validateModelConfiguration(
  model: {
    contextWindowTokens: number;
    maxOutputTokens: number;
    supportedReasoningEfforts: z.infer<typeof modelReasoningEffortsSchema>;
    defaultReasoningEffort: z.infer<typeof reasoningEffortSchema>;
  },
  context: z.RefinementCtx,
): void {
  if (model.contextWindowTokens <= model.maxOutputTokens) {
    context.addIssue({
      code: 'custom',
      path: ['contextWindowTokens'],
      message: 'Context window must exceed max output tokens',
    });
  }
  if (!model.supportedReasoningEfforts.includes(model.defaultReasoningEffort)) {
    context.addIssue({
      code: 'custom',
      path: ['defaultReasoningEffort'],
      message: 'Default reasoning effort must be supported',
    });
  }
}

export const discoveredModelSchema = z.strictObject({
  id: z.string().min(1),
  displayName: z.string().min(1).optional(),
  ownedBy: z.string().min(1).optional(),
  createdAt: z.string().datetime({ offset: true }).optional(),
});

export const providerModelDiscoveryResultSchema = z.strictObject({
  providerProfileId: idSchema,
  models: z.array(discoveredModelSchema).max(500),
  truncated: z.boolean(),
});

export const modelImportResultSchema = z.strictObject({
  created: z.array(idSchema),
  skipped: z.array(z.string().min(1)),
});

export const auditEventViewSchema = z.strictObject({
  id: idSchema,
  type: z.string().min(1),
  sessionId: idSchema.optional(),
  taskId: idSchema.optional(),
  occurredAt: z.string().datetime({ offset: true }),
  summary: z.string(),
});

export const coreStatusViewSchema = z.strictObject({
  connected: z.boolean(),
  version: z.string().min(1),
  instanceId: idSchema.optional(),
  sessions: z.number().int().nonnegative().optional(),
  agentTasks: z.number().int().nonnegative().optional(),
});

export const coreRequestSchema = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('session.list'), payload: emptyPayloadSchema }),
  z.strictObject({ method: z.literal('session.create'), payload: sessionLaunchSchema }),
  z.strictObject({
    method: z.literal('session.setDialect'),
    payload: z.strictObject({ sessionId: idSchema, executionDialect: executionDialectSchema }),
  }),
  z.strictObject({
    method: z.literal('session.close'),
    payload: z.strictObject({ sessionId: idSchema }),
  }),
  z.strictObject({
    method: z.literal('terminal.write'),
    payload: z.strictObject({ sessionId: idSchema, data: z.string() }),
  }),
  z.strictObject({
    method: z.literal('terminal.resize'),
    payload: z.strictObject({
      sessionId: idSchema,
      columns: z.number().int().positive().max(1_000),
      rows: z.number().int().positive().max(1_000),
    }),
  }),
  z.strictObject({
    method: z.literal('terminal.replay'),
    payload: z.strictObject({
      sessionId: idSchema,
      afterSequence: z.number().int().nonnegative(),
    }),
  }),
  z.strictObject({
    method: z.literal('resources.get'),
    payload: z.strictObject({ sessionId: idSchema }),
  }),
  z.strictObject({
    method: z.literal('resources.refresh'),
    payload: z.strictObject({ sessionId: idSchema }),
  }),
  z.strictObject({
    method: z.literal('agent.start'),
    payload: z.strictObject({
      sessionId: idSchema,
      goal: z.string().min(1),
      modelConfigurationId: idSchema.optional(),
      reasoningEffort: reasoningEffortSchema.optional(),
      permissionMode: permissionModeSchema.optional(),
    }),
  }),
  z.strictObject({
    method: z.literal('agent.cancel'),
    payload: z.strictObject({ sessionId: idSchema, turnId: idSchema.optional() }),
  }),
  z.strictObject({
    method: z.literal('agent.history'),
    payload: z.strictObject({ sessionId: idSchema }),
  }),
  z.strictObject({
    method: z.literal('agent.resetConversation'),
    payload: z.strictObject({
      sessionId: idSchema,
      expectedConversationId: idSchema,
    }),
  }),
  z.strictObject({
    method: z.literal('agent.interrupt'),
    payload: z.strictObject({ sessionId: idSchema, transactionId: idSchema }),
  }),
  z.strictObject({
    method: z.literal('agent.approve'),
    payload: z.strictObject({
      sessionId: idSchema,
      approvalId: idSchema,
      confirmedDestructive: z.boolean(),
    }),
  }),
  z.strictObject({
    method: z.literal('agent.takeover'),
    payload: z.strictObject({ sessionId: idSchema }),
  }),
  z.strictObject({ method: z.literal('provider.list'), payload: emptyPayloadSchema }),
  z.strictObject({
    method: z.literal('provider.save'),
    payload: z.strictObject({
      profile: providerProfileInputSchema,
      apiKey: z.string().min(1).optional(),
    }),
  }),
  z.strictObject({
    method: z.literal('provider.discoverModels'),
    payload: z.strictObject({ providerId: idSchema }),
  }),
  z.strictObject({
    method: z.literal('provider.cancelDiscovery'),
    payload: z.strictObject({ providerId: idSchema }),
  }),
  z.strictObject({
    method: z.literal('provider.remove'),
    payload: z.strictObject({ providerId: idSchema }),
  }),
  z.strictObject({ method: z.literal('model.list'), payload: emptyPayloadSchema }),
  z.strictObject({
    method: z.literal('model.save'),
    payload: z.strictObject({ model: modelConfigurationInputSchema }),
  }),
  z.strictObject({
    method: z.literal('model.test'),
    payload: z.strictObject({ modelConfigurationId: idSchema }),
  }),
  z.strictObject({
    method: z.literal('model.setEnabled'),
    payload: z.strictObject({ modelConfigurationId: idSchema, enabled: z.boolean() }),
  }),
  z.strictObject({
    method: z.literal('model.setDefault'),
    payload: z.strictObject({ modelConfigurationId: idSchema, isDefault: z.boolean() }),
  }),
  z.strictObject({
    method: z.literal('model.remove'),
    payload: z.strictObject({ modelConfigurationId: idSchema }),
  }),
  z.strictObject({
    method: z.literal('model.importDiscovered'),
    payload: z.strictObject({
      providerProfileId: idSchema,
      modelIds: z.array(z.string().min(1)).min(1).max(500),
    }),
  }),
  z.strictObject({
    method: z.literal('audit.list'),
    payload: z.strictObject({ sessionId: idSchema.optional(), taskId: idSchema.optional() }),
  }),
  z.strictObject({ method: z.literal('audit.cleanup'), payload: emptyPayloadSchema }),
  z.strictObject({ method: z.literal('core.status'), payload: emptyPayloadSchema }),
  z.strictObject({
    method: z.literal('core.shutdown'),
    payload: z.strictObject({ mode: z.enum(['keep_background', 'terminate_all']) }),
  }),
]);

export const coreServiceEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('agent.timeline'),
    streamId: idSchema,
    payload: agentTimelineItemSchema,
  }),
  z.strictObject({
    type: z.literal('session.changed'),
    streamId: idSchema,
    payload: sessionSummarySchema,
  }),
  z.strictObject({
    type: z.literal('session.resources'),
    streamId: idSchema,
    payload: z.strictObject({
      sessionId: idSchema,
      snapshot: sessionResourceSnapshotSchema,
    }),
  }),
  z.strictObject({
    type: z.literal('core.status'),
    streamId: idSchema,
    payload: coreStatusViewSchema,
  }),
]);

export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type SessionLaunch = z.infer<typeof sessionLaunchSchema>;
export type SessionLaunchMetadata = z.infer<typeof sessionLaunchMetadataSchema>;
export type TerminalReplay = z.infer<typeof terminalReplaySchema>;
export type LocalFileChange = z.infer<typeof localFileChangeSchema>;
export type AgentTimelineItem = z.infer<typeof agentTimelineItemSchema>;
export type AgentHistoryView = z.infer<typeof agentHistoryViewSchema>;
export type SessionResourceSnapshot = z.infer<typeof sessionResourceSnapshotSchema>;
export type SessionResourceRefreshError = z.infer<typeof sessionResourceRefreshErrorSchema>;
export type SessionResourceRefreshResult = z.infer<typeof sessionResourceRefreshResultSchema>;
export type ProviderProfileInput = z.infer<typeof providerProfileInputSchema>;
export type ProviderProfileView = z.infer<typeof providerProfileViewSchema>;
export type ModelConfigurationInput = z.infer<typeof modelConfigurationInputSchema>;
export type ModelConfigurationView = z.infer<typeof modelConfigurationViewSchema>;
export type DiscoveredModel = z.infer<typeof discoveredModelSchema>;
export type ProviderModelDiscoveryResult = z.infer<typeof providerModelDiscoveryResultSchema>;
export type ModelImportResult = z.infer<typeof modelImportResultSchema>;
export type AuditEventView = z.infer<typeof auditEventViewSchema>;
export type CoreStatusView = z.infer<typeof coreStatusViewSchema>;
export type CoreRequest = z.infer<typeof coreRequestSchema>;
export type CoreRequestMethod = CoreRequest['method'];
export type CoreServiceEvent = z.infer<typeof coreServiceEventSchema>;

export function parseCoreRequest(method: string, payload: unknown): CoreRequest {
  return coreRequestSchema.parse({ method, payload });
}
