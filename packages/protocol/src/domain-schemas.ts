import { z } from 'zod';

const idSchema = z.string().min(1);
const epochSchema = z.number().int().nonnegative();
export const permissionModeSchema = z.enum(['manual', 'auto', 'full_access']);
export const reasoningEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh']);
export const modelCapabilitiesSchema = z.strictObject({
  responses: z.boolean(),
  streaming: z.boolean(),
  toolCalls: z.boolean(),
  reasoning: z.boolean().optional(),
});

const leaseOwnerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('user') }),
  z.strictObject({ kind: z.literal('agent'), taskId: idSchema }),
  z.strictObject({ kind: z.literal('none') }),
]);

export const executionEnvironmentSchema = z.strictObject({
  dialect: z.enum(['posix', 'powershell', 'observe_only']),
  platform: z.enum(['windows', 'unix', 'unknown']),
  operatingSystem: z.enum(['windows', 'linux', 'macos', 'unknown']).default('unknown'),
  verificationStatus: z.enum(['unverified', 'verified', 'observation_only']),
  capabilityEpoch: epochSchema,
  verifiedAt: z.string().optional(),
  source: z.enum(['fingerprint', 'manual_hint']).optional(),
});

export const sessionStateSchema = z.strictObject({
  id: idSchema,
  pty: z.enum(['starting', 'running', 'exited', 'failed', 'interrupted']),
  attachment: z.enum(['attached', 'detached']),
  shell: z.enum(['unknown', 'probing', 'ready', 'executing', 'interaction_required']),
  executionDialect: z.enum(['posix', 'powershell', 'observe_only']).default('observe_only'),
  shellCapabilityEpoch: epochSchema,
  lease: z.strictObject({
    owner: leaseOwnerSchema,
    epoch: epochSchema,
  }),
  environment: executionEnvironmentSchema.default({
    dialect: 'observe_only',
    platform: 'unknown',
    operatingSystem: 'unknown',
    verificationStatus: 'unverified',
    capabilityEpoch: 0,
  }),
});

export const agentConversationSchema = z.strictObject({
  id: idSchema,
  sessionId: idSchema,
  status: z.enum(['active', 'reset']),
  permissionMode: permissionModeSchema.default('auto'),
  revision: epochSchema,
});

export const agentTurnSchema = z.strictObject({
  id: idSchema,
  conversationId: idSchema,
  sessionId: idSchema,
  modelConfigurationId: idSchema,
  modelConfigurationRevision: epochSchema,
  modelConfigurationName: z.string().min(1),
  providerProfileId: idSchema,
  providerProfileRevision: epochSchema,
  providerProfileName: z.string().min(1),
  protocol: z.enum(['openai_responses', 'openai_chat_completions', 'anthropic_messages']),
  modelId: z.string().min(1),
  capabilities: modelCapabilitiesSchema,
  contextWindowTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  autoCompact: z.boolean(),
  compactThresholdPercent: z.number().int().min(50).max(95),
  supportedReasoningEfforts: z.array(reasoningEffortSchema).min(1),
  defaultReasoningEffort: reasoningEffortSchema,
  reasoningEffort: reasoningEffortSchema.default('low'),
  permissionMode: permissionModeSchema.default('auto'),
  userMessage: z.string().min(1),
  status: z.enum([
    'queued',
    'running',
    'waiting_approval',
    'waiting_user',
    'suspended',
    'completed',
    'failed',
    'cancelled',
  ]),
  revision: epochSchema,
});

const modelItemBaseShape = {
  id: idSchema,
  conversationId: idSchema,
  turnId: idSchema,
  sequence: epochSchema,
};

export const modelItemSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...modelItemBaseShape, type: z.literal('system_text'), content: z.string() }),
  z.strictObject({ ...modelItemBaseShape, type: z.literal('user_text'), content: z.string() }),
  z.strictObject({ ...modelItemBaseShape, type: z.literal('assistant_text'), content: z.string() }),
  z.strictObject({
    ...modelItemBaseShape,
    type: z.literal('assistant_tool_call'),
    toolCallId: idSchema,
    name: z.string().min(1),
    argumentsJson: z.string(),
  }),
  z.strictObject({
    ...modelItemBaseShape,
    type: z.literal('tool_result'),
    toolCallId: idSchema,
    content: z.string(),
    isError: z.boolean(),
  }),
]);

export const toolCallRecordSchema = z.strictObject({
  id: idSchema,
  conversationId: idSchema,
  turnId: idSchema,
  name: z.string().min(1),
  argumentsJson: z.string(),
  status: z.enum([
    'proposed',
    'validating',
    'waiting_approval',
    'running',
    'completed',
    'recoverable_error',
    'fatal_error',
    'cancelled',
  ]),
  revision: epochSchema,
});

export const conversationCompactionSchema = z.strictObject({
  id: idSchema,
  conversationId: idSchema,
  throughSequence: epochSchema,
  summary: z.string().min(1),
  sourceItemCount: z.number().int().positive(),
  estimatedTokensBefore: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
});

export const agentTaskSchema = z.strictObject({
  id: idSchema,
  sessionId: idSchema,
  providerProfileId: idSchema,
  goal: z.string().min(1),
  status: z.enum([
    'queued',
    'running',
    'waiting_approval',
    'waiting_user',
    'suspended',
    'completed',
    'failed',
    'cancelled',
  ]),
  revision: epochSchema,
});

export const commandRiskSchema = z.enum([
  'read_only',
  'unknown',
  'mutating',
  'privileged',
  'destructive',
]);

const transactionBaseShape = {
  id: idSchema,
  sessionId: idSchema,
  taskId: idSchema,
  command: z.string().min(1),
  nonce: z.string().min(1),
  revision: epochSchema,
};

const leasedTransactionShape = {
  ...transactionBaseShape,
  risk: commandRiskSchema,
  leaseEpoch: epochSchema,
  approvalGrantId: idSchema.optional(),
};

export const commandTransactionSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...transactionBaseShape, status: z.literal('draft') }),
  z.strictObject({
    ...transactionBaseShape,
    status: z.literal('policy_checked'),
    risk: commandRiskSchema,
  }),
  z.strictObject({
    ...transactionBaseShape,
    status: z.literal('waiting_approval'),
    risk: commandRiskSchema,
  }),
  z.strictObject({ ...leasedTransactionShape, status: z.literal('lease_acquired') }),
  z.strictObject({ ...leasedTransactionShape, status: z.literal('dispatched') }),
  z.strictObject({ ...leasedTransactionShape, status: z.literal('running') }),
  z.strictObject({
    ...leasedTransactionShape,
    status: z.literal('completed'),
    exitCode: z.number().int(),
  }),
  ...(['interaction_required', 'interrupted', 'shell_lost', 'protocol_error'] as const).map(
    (status) =>
      z.strictObject({
        ...leasedTransactionShape,
        status: z.literal(status),
        reason: z.string().min(1),
      }),
  ),
]);

const approvedCommandSchema = z.strictObject({
  sequence: epochSchema,
  command: z.string().min(1),
  commandHash: z.string().min(1),
  risk: z.strictObject({
    level: commandRiskSchema,
    reasons: z.array(z.string().min(1)).min(1),
  }),
});

export const approvalGrantSchema = z.strictObject({
  id: idSchema,
  sessionId: idSchema,
  taskId: idSchema,
  environmentEpoch: epochSchema.optional(),
  scope: z
    .strictObject({
      conversationId: idSchema,
      turnId: idSchema,
      toolCallId: idSchema,
    })
    .optional(),
  commands: z.array(approvedCommandSchema).min(1),
  grantedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

export const modelValidationSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unverified') }),
  z.strictObject({
    status: z.literal('validating'),
    attempt: z.number().int().positive(),
  }),
  z.strictObject({
    status: z.literal('available'),
    checkedAt: z.string().datetime({ offset: true }),
    capabilities: modelCapabilitiesSchema,
    attempt: z.number().int().positive(),
  }),
  z.strictObject({
    status: z.literal('unavailable'),
    checkedAt: z.string().datetime({ offset: true }),
    reason: z.string().min(1),
    attempt: z.number().int().positive(),
  }),
]);

export const providerProfileSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  protocol: z.enum(['openai_responses', 'openai_chat_completions', 'anthropic_messages']),
  baseUrl: z.string().url(),
  credentialRef: z.string().min(1),
  extraHeaders: z.record(z.string().min(1), z.string()),
  timeoutMs: z.number().int().positive(),
  revision: epochSchema,
});

export const modelConfigurationSchema = z
  .strictObject({
    id: idSchema,
    name: z.string().min(1),
    providerProfileId: idSchema,
    modelId: z.string().min(1),
    declaredCapabilities: modelCapabilitiesSchema,
    contextWindowTokens: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    autoCompact: z.boolean(),
    compactThresholdPercent: z.number().int().min(50).max(95),
    supportedReasoningEfforts: z.array(reasoningEffortSchema).min(1),
    defaultReasoningEffort: reasoningEffortSchema,
    enabled: z.boolean(),
    isDefault: z.boolean(),
    validation: modelValidationSchema,
    revision: epochSchema,
  })
  .superRefine((model, context) => {
    if (model.contextWindowTokens <= model.maxOutputTokens) {
      context.addIssue({
        code: 'custom',
        path: ['contextWindowTokens'],
        message: 'context window must exceed max output tokens',
      });
    }
    if (!model.supportedReasoningEfforts.includes(model.defaultReasoningEffort)) {
      context.addIssue({
        code: 'custom',
        path: ['defaultReasoningEffort'],
        message: 'default reasoning effort must be supported',
      });
    }
    if (model.isDefault && !model.enabled) {
      context.addIssue({
        code: 'custom',
        path: ['isDefault'],
        message: 'default model must be enabled',
      });
    }
  });

export type SessionStateMessage = z.infer<typeof sessionStateSchema>;
export type AgentConversationMessage = z.infer<typeof agentConversationSchema>;
export type AgentTurnMessage = z.infer<typeof agentTurnSchema>;
export type ModelItemMessage = z.infer<typeof modelItemSchema>;
export type ToolCallRecordMessage = z.infer<typeof toolCallRecordSchema>;
export type ConversationCompactionMessage = z.infer<typeof conversationCompactionSchema>;
export type AgentTaskMessage = z.infer<typeof agentTaskSchema>;
export type CommandTransactionMessage = z.infer<typeof commandTransactionSchema>;
export type ApprovalGrantMessage = z.infer<typeof approvalGrantSchema>;
export type ProviderProfileMessage = z.infer<typeof providerProfileSchema>;
export type ModelConfigurationMessage = z.infer<typeof modelConfigurationSchema>;
