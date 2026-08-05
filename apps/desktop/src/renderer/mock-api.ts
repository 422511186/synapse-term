import type {
  AcpHistoryView,
  AcpStatus,
  AcpTurnView,
  AgentTextDelta,
  AgentTimelineItem,
  AgentHistoryView,
  AuditListRequest,
  AuditListResponse,
  AuditTraceDetailView,
  AuditTraceEventView,
  AuditTraceView,
  DesktopApi,
  McpApprovalMode,
  ModelConfigurationInput,
  ModelConfigurationView,
  PickedAgentAttachment,
  ProviderProfileView,
  SessionResourceEvent,
  SessionResourceSnapshot,
  SessionSummary,
  TerminalOutputEvent,
} from '../preload/preload-api.js';

export function createMockDesktopApi(): DesktopApi {
  const scenarioParams =
    typeof globalThis.location === 'undefined'
      ? undefined
      : new URLSearchParams(globalThis.location.search);
  const sessionScenario = scenarioParams?.get('sessions');
  const requestedStaleSessionCount = Number(scenarioParams?.get('stale'));
  const requestedSessionCount = Number(sessionScenario);
  const emptySessionsScenario = sessionScenario === 'empty';
  const sessions: SessionSummary[] = emptySessionsScenario
    ? []
    : Number.isInteger(requestedSessionCount) && requestedSessionCount > 0
      ? Array.from({ length: Math.min(requestedSessionCount, 20) }, (_, index) => ({
          id: `session-${index + 1}`,
          title: `session ${index + 1}`,
          terminalType: 'Git Bash',
          pty:
            Number.isInteger(requestedStaleSessionCount) && requestedStaleSessionCount > index
              ? 'failed'
              : 'running',
          shell:
            Number.isInteger(requestedStaleSessionCount) && requestedStaleSessionCount > index
              ? 'unknown'
              : 'ready',
          executionDialect: 'posix',
          agentStatus: 'idle',
        }))
      : [
          {
            id: 'session-local',
            title: 'api-prod / bash',
            terminalType: 'Git Bash',
            pty: 'running',
            shell: 'ready',
            executionDialect: 'posix',
            agentStatus: 'idle',
          },
          {
            id: 'session-logs',
            title: 'logs / container',
            terminalType: 'Container logs',
            pty: 'running',
            shell: 'unknown',
            executionDialect: 'observe_only',
          },
        ];
  const providers: ProviderProfileView[] = [
    {
      id: 'provider-openai',
      name: 'OpenAI 官方',
      protocol: 'openai_responses',
      baseUrl: 'https://api.openai.com/v1',
      extraHeaders: {},
      timeoutMs: 30_000,
      credentialConfigured: true,
      revision: 1,
    },
  ];
  const models: ModelConfigurationView[] = [
    {
      id: 'model-openai',
      name: 'GPT-5',
      providerProfileId: 'provider-openai',
      providerName: 'OpenAI 官方',
      providerProtocol: 'openai_responses',
      modelId: 'gpt-5',
      declaredCapabilities: {
        responses: true,
        streaming: true,
        toolCalls: true,
        reasoning: true,
        multimodal: true,
      },
      contextWindowTokens: 128_000,
      maxOutputTokens: 4_096,
      autoCompact: true,
      compactThresholdPercent: 80,
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'medium',
      enabled: true,
      isDefault: true,
      status: 'available',
      validation: {
        status: 'available',
        checkedAt: new Date().toISOString(),
        attempt: 1,
        capabilities: {
          responses: true,
          streaming: true,
          toolCalls: true,
          multimodal: true,
        },
      },
      revision: 1,
    },
    {
      id: 'model-fast',
      name: '快速诊断',
      providerProfileId: 'provider-openai',
      providerName: 'OpenAI 官方',
      providerProtocol: 'openai_responses',
      modelId: 'gpt-5-mini',
      declaredCapabilities: {
        responses: true,
        streaming: true,
        toolCalls: true,
        multimodal: false,
      },
      contextWindowTokens: 128_000,
      maxOutputTokens: 4_096,
      autoCompact: true,
      compactThresholdPercent: 80,
      supportedReasoningEfforts: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'low',
      enabled: false,
      isDefault: false,
      status: 'unverified',
      validation: { status: 'unverified' },
      revision: 1,
    },
  ];
  const auditEvent: AuditTraceEventView = {
    id: 'audit-1',
    type: 'session.created',
    sessionId: 'session-local',
    occurredAt: new Date(Date.now() - 180_000).toISOString(),
    actor: { kind: 'system' },
    category: 'session',
    outcome: 'success',
    risk: 'read_only',
    summary: '本机终端会话已连接',
  };
  const demoCommand = 'df -h && systemctl --failed --no-pager';
  const demoTaskId = 'task-demo-command';
  const demoTaskStarted: AuditTraceEventView = {
    id: 'audit-demo-task-started',
    type: 'task.started',
    sessionId: 'session-local',
    taskId: demoTaskId,
    occurredAt: new Date(Date.now() - 50_000).toISOString(),
    actor: { kind: 'user' },
    category: 'session',
    outcome: 'in_progress',
    risk: 'read_only',
    summary: 'Agent 任务开始',
  };
  const demoCommandEvent: AuditTraceEventView = {
    id: 'audit-demo-command',
    type: 'command.completed',
    sessionId: 'session-local',
    taskId: demoTaskId,
    occurredAt: new Date(Date.now() - 45_000).toISOString(),
    actor: { kind: 'agent', taskId: demoTaskId },
    category: 'command',
    outcome: 'success',
    risk: 'read_only',
    summary: demoCommand,
    commandPreview: demoCommand,
    commandHash: 'sha256:mock-demo-command',
    exitCode: 0,
    details: [
      { label: '执行状态', value: 'completed' },
      { label: '执行方言', value: 'posix' },
    ],
  };
  const demoTaskCompleted: AuditTraceEventView = {
    id: 'audit-demo-task-completed',
    type: 'task.completed',
    sessionId: 'session-local',
    taskId: demoTaskId,
    occurredAt: new Date(Date.now() - 40_000).toISOString(),
    actor: { kind: 'system' },
    category: 'session',
    outcome: 'success',
    risk: 'read_only',
    summary: 'Agent 任务完成',
  };
  const demoCommandTrace: AuditTraceView = {
    traceId: `task:${demoTaskId}`,
    subject: 'agent_task',
    sessionId: 'session-local',
    taskId: demoTaskId,
    actor: { kind: 'agent', taskId: demoTaskId },
    category: 'command',
    startedAt: demoTaskStarted.occurredAt,
    lastActivityAt: demoTaskCompleted.occurredAt,
    outcome: 'success',
    risk: 'read_only',
    summary: `命令：${demoCommand}`,
    eventCount: 3,
    containsObservations: false,
  };
  const auditTrace: AuditTraceView = {
    traceId: 'event:audit-1',
    subject: 'event',
    sessionId: 'session-local',
    actor: { kind: 'system' },
    category: 'session',
    startedAt: auditEvent.occurredAt,
    lastActivityAt: auditEvent.occurredAt,
    outcome: 'success',
    risk: 'read_only',
    summary: auditEvent.summary,
    eventCount: 1,
    containsObservations: false,
  };
  const auditEventTwo: AuditTraceEventView = {
    ...auditEvent,
    id: 'audit-2',
    type: 'session.renamed',
    occurredAt: new Date(Date.now() - 120_000).toISOString(),
    summary: '本机终端会话名称已更新',
  };
  const auditTraceTwo: AuditTraceView = {
    ...auditTrace,
    traceId: 'event:audit-2',
    startedAt: auditEventTwo.occurredAt,
    lastActivityAt: auditEventTwo.occurredAt,
    summary: auditEventTwo.summary,
  };
  const auditObservationEvent: AuditTraceEventView = {
    ...auditEvent,
    id: 'audit-observation',
    type: 'external.observe',
    occurredAt: new Date(Date.now() - 60_000).toISOString(),
    actor: { kind: 'external', callerKind: 'mcp', callerId: 'mock-client' },
    category: 'observation',
    outcome: 'information',
    summary: '终端状态已观察',
  };
  const auditObservationTrace: AuditTraceView = {
    ...auditTrace,
    traceId: 'event:audit-observation',
    actor: auditObservationEvent.actor,
    category: 'observation',
    startedAt: auditObservationEvent.occurredAt,
    lastActivityAt: auditObservationEvent.occurredAt,
    outcome: 'information',
    summary: auditObservationEvent.summary,
    containsObservations: true,
  };
  let audit: AuditTraceView[] = [
    demoCommandTrace,
    auditTrace,
    auditTraceTwo,
    auditObservationTrace,
  ];
  let auditDetails: AuditTraceDetailView[] = [
    {
      ...demoCommandTrace,
      events: [demoTaskStarted, demoCommandEvent, demoTaskCompleted],
    },
    { ...auditTrace, events: [auditEvent] },
    { ...auditTraceTwo, events: [auditEventTwo] },
    { ...auditObservationTrace, events: [auditObservationEvent] },
  ];

  const recordMockAuditEvent = (event: AuditTraceEventView): void => {
    const traceId =
      event.taskId === undefined
        ? event.transactionId === undefined
          ? `event:${event.id}`
          : `transaction:${event.transactionId}`
        : `task:${event.taskId}`;
    const current = auditDetails.find((detail) => detail.traceId === traceId);
    const events = [...(current?.events ?? []), event].sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id),
    );
    const command = [...events].reverse().find((item) => item.commandPreview !== undefined);
    const latest = events.at(-1)!;
    const outcome = events.some((item) => item.outcome === 'rejected')
      ? 'rejected'
      : events.some((item) => item.outcome === 'failure')
        ? 'failure'
        : events.some((item) => item.outcome === 'interrupted')
          ? 'interrupted'
          : events.some((item) => item.outcome === 'success')
            ? 'success'
            : events.some((item) => item.outcome === 'in_progress')
              ? 'in_progress'
              : 'information';
    const trace: AuditTraceView = {
      traceId,
      subject:
        event.taskId === undefined
          ? event.transactionId === undefined
            ? 'event'
            : 'external_transaction'
          : 'agent_task',
      ...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }),
      ...(event.taskId === undefined ? {} : { taskId: event.taskId }),
      ...(event.transactionId === undefined ? {} : { transactionId: event.transactionId }),
      actor: command?.actor ?? current?.actor ?? event.actor,
      category: command?.category ?? current?.category ?? event.category,
      startedAt: events[0]!.occurredAt,
      lastActivityAt: latest.occurredAt,
      outcome,
      risk: command?.risk ?? current?.risk ?? event.risk,
      summary:
        command?.commandPreview === undefined ? latest.summary : `命令：${command.commandPreview}`,
      eventCount: events.length,
      containsObservations: events.some((item) => item.category === 'observation'),
    };
    auditDetails = [
      ...auditDetails.filter((detail) => detail.traceId !== traceId),
      { ...trace, events },
    ];
    audit = [...audit.filter((item) => item.traceId !== traceId), trace];
  };
  const outputListeners = new Set<(event: TerminalOutputEvent) => void>();
  const sessionChangedListeners = new Set<(event: SessionSummary) => void>();
  const timelineListeners = new Set<(event: AgentTimelineItem) => void>();
  const textDeltaListeners = new Set<(event: AgentTextDelta) => void>();
  const resourceListeners = new Set<(event: SessionResourceEvent) => void>();
  const resourceSnapshots = new Map<string, SessionResourceSnapshot>();
  const discoveryRequests = new Map<string, { cancelled: boolean }>();
  const conversations = new Map<
    string,
    {
      conversation: NonNullable<AgentHistoryView['conversation']>;
      turns: AgentHistoryView['turns'];
      items: AgentHistoryView['items'];
      sequence: number;
      activeTurnId?: string;
    }
  >();
  const attachmentTickets = new Map<string, PickedAgentAttachment>();
  const pendingApprovals = new Map<
    string,
    {
      id: string;
      sessionId: string;
      conversationId: string;
      turnId: string;
      taskId: string;
      command: string;
      risk: 'mutating' | 'destructive';
      reasons: string[];
      change?: NonNullable<AgentTimelineItem['change']>;
    }
  >();
  const runningCommands = new Map<
    string,
    {
      id: string;
      text: string;
      taskId: string;
      turnId: string;
      conversationId: string;
      toolCallId: string;
    }
  >();
  let historyCalls = 0;
  let sequence = 0;
  let coreConnected = true;

  const searchParam = (name: string): string | undefined =>
    typeof globalThis.location === 'undefined'
      ? undefined
      : (new URLSearchParams(globalThis.location.search).get(name) ?? undefined);

  const emitOutput = (sessionId: string, data: string): void => {
    sequence += 1;
    const event = { sessionId, sequence, data };
    for (const listener of outputListeners) listener(event);
  };
  const emitTimeline = (item: AgentTimelineItem): void => {
    for (const listener of timelineListeners) listener(item);
  };
  const emitSessionChanged = (session: SessionSummary): void => {
    const snapshot = structuredClone(session);
    for (const listener of sessionChangedListeners) listener(snapshot);
  };

  return {
    sessions: {
      list: async () => structuredClone(sessions),
      environment: async () => ({
        home: '.',
        shells: [
          {
            kind: 'bash',
            label: 'Git Bash',
            available: true,
            source: 'path',
            executable: 'mock-bash',
            args: ['-i'],
            executionDialect: 'posix',
          },
          {
            kind: 'powershell',
            label: 'PowerShell',
            available: true,
            source: 'path',
            executable: 'mock-powershell',
            args: ['-NoLogo'],
            executionDialect: 'powershell',
          },
        ],
      }),
      create: async (input) => {
        if (input.cwd === 'Z:/terminal-agent-missing-path') {
          throw new Error('Working directory does not exist');
        }
        const session: SessionSummary = {
          id: `session-${sessions.length + 1}`,
          title: input.title,
          terminalType: input.terminalType,
          pty: 'running',
          shell: 'unknown',
          executionDialect: input.executionDialect,
        };
        sessions.push(session);
        emitSessionChanged(session);
        return structuredClone(session);
      },
      rename: async (sessionId, alias) => {
        const session = sessions.find((candidate) => candidate.id === sessionId);
        if (session === undefined) throw new Error('终端会话不存在');
        const normalized = alias.trim();
        if (normalized.length === 0) throw new Error('会话名称不能为空');
        session.title = normalized;
        emitSessionChanged(session);
        return structuredClone(session);
      },
      setDialect: async (sessionId, executionDialect) => {
        const session = sessions.find((candidate) => candidate.id === sessionId);
        if (session === undefined) throw new Error('终端会话不存在');
        session.executionDialect = executionDialect;
        session.shell = 'unknown';
        emitSessionChanged(session);
        return structuredClone(session);
      },
      markShared: async (sessionId) => {
        const session = sessions.find((candidate) => candidate.id === sessionId);
        if (session === undefined) throw new Error('终端会话不存在');
        session.shared = true;
        emitSessionChanged(session);
        return structuredClone(session);
      },
      close: async (sessionId) => {
        const index = sessions.findIndex((session) => session.id === sessionId);
        if (index < 0) return false;
        sessions.splice(index, 1);
        return true;
      },
      onChanged: (listener) => {
        sessionChangedListeners.add(listener);
        return () => sessionChangedListeners.delete(listener);
      },
    },
    terminal: {
      write: async (sessionId, data) => {
        emitOutput(sessionId, data);
        if (data.endsWith('\r')) {
          const command = data.trim();
          const response = command.includes('df')
            ? '\r\nFilesystem      Size  Used Avail Use% Mounted on\r\n/dev/sda1       120G   63G   51G  56% /\r\n'
            : '\r\n';
          emitOutput(
            sessionId,
            `${response}\u001b[38;5;71mops@api-prod\u001b[0m:\u001b[38;5;75m~\u001b[0m$ `,
          );
        }
      },
      resize: async () => undefined,
      replay: async () => ({
        historyGap: false,
        events: [],
        nextSequence: sequence + 1,
        hasMore: false,
        nextAfterSequence: sequence,
      }),
      onOutput: (listener) => {
        outputListeners.add(listener);
        return () => outputListeners.delete(listener);
      },
    },
    resources: {
      get: async (sessionId) => structuredClone(resourceSnapshots.get(sessionId)),
      refresh: async (sessionId) => {
        const session = sessions.find((candidate) => candidate.id === sessionId);
        if (session === undefined) {
          return {
            ok: false,
            error: { code: 'session_not_found' as const, message: '终端会话不存在。' },
          };
        }
        if (session.executionDialect === 'observe_only') {
          return {
            ok: false,
            error: {
              code: 'execution_dialect_unsupported' as const,
              message: '当前终端会话的执行方言不支持资源刷新。',
            },
          };
        }
        await new Promise((resolve) => globalThis.setTimeout(resolve, 220));
        const partial =
          typeof globalThis.location !== 'undefined' &&
          new URLSearchParams(globalThis.location.search).get('resources') === 'partial';
        const snapshot = createMockResourceSnapshot(
          session.executionDialect === 'powershell' ? 'powershell' : 'posix',
          partial,
        );
        resourceSnapshots.set(sessionId, snapshot);
        const event = { sessionId, snapshot: structuredClone(snapshot) };
        for (const listener of resourceListeners) listener(event);
        return { ok: true, snapshot: structuredClone(snapshot) };
      },
      onSnapshot: (listener) => {
        resourceListeners.add(listener);
        return () => resourceListeners.delete(listener);
      },
    },
    attachments: {
      pick: async (options) => {
        const currentCount = options.currentCount ?? 0;
        if (currentCount > 8 || currentCount >= 8) {
          throw new Error('一次任务最多可携带 8 个附件。');
        }
        const attachment: PickedAgentAttachment =
          options.kind === 'image'
            ? {
                attachmentId: `attachment-${crypto.randomUUID()}`,
                name: '截图.png',
                mimeType: 'image/png',
                sizeBytes: 1_024,
                kind: 'image',
              }
            : {
                attachmentId: `attachment-${crypto.randomUUID()}`,
                name: 'notes.txt',
                mimeType: 'text/plain',
                sizeBytes: 2_048,
                kind: 'file',
              };
        attachmentTickets.set(attachment.attachmentId, attachment);
        return [structuredClone(attachment)];
      },
    },
    agent: {
      start: async (sessionId, goal, options = {}) => {
        const attachments = options.attachments ?? [];
        if (attachments.length > 8) {
          throw new Error('一次任务最多可携带 8 个附件。');
        }
        let history = conversations.get(sessionId);
        if (history === undefined) {
          history = {
            conversation: {
              id: `conversation-${crypto.randomUUID()}`,
              sessionId,
              driver: 'builtin',
              status: 'active',
              permissionMode: options.permissionMode ?? 'auto',
              revision: 0,
            },
            turns: [],
            items: [],
            sequence: 0,
          };
          conversations.set(sessionId, history);
        } else if (
          options.permissionMode !== undefined &&
          history.conversation.permissionMode !== options.permissionMode
        ) {
          history.conversation.permissionMode = options.permissionMode;
          history.conversation.revision += 1;
        }
        const requestedModel =
          options.modelConfigurationId === undefined
            ? undefined
            : models.find((item) => item.id === options.modelConfigurationId);
        if (options.modelConfigurationId !== undefined && requestedModel === undefined) {
          throw new Error('模型配置不存在');
        }
        const model =
          requestedModel ??
          models.find((item) => item.isDefault && isEligibleModel(item)) ??
          models.find(isEligibleModel);
        if (model === undefined || !isEligibleModel(model)) {
          throw new Error('模型尚未启用');
        }
        const provider = providers.find((item) => item.id === model.providerProfileId);
        if (provider === undefined) throw new Error('Provider 不存在');
        for (const attachment of attachments) {
          if (attachment.kind === 'image' && model.declaredCapabilities.multimodal !== true) {
            throw new Error('当前模型不支持图片输入。');
          }
          if (
            attachment.kind === 'image' &&
            !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(attachment.mimeType)
          ) {
            throw new Error(`不支持的图片类型：${attachment.mimeType}。`);
          }
          const limit = attachment.kind === 'image' ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
          if (attachment.sizeBytes > limit) {
            throw new Error(
              attachment.kind === 'image' ? '图片不能超过 10 MiB。' : '文件不能超过 50 MiB。',
            );
          }
          const ticket = attachmentTickets.get(attachment.attachmentId);
          if (ticket === undefined) {
            throw new Error('附件凭证已失效，请重新选择附件。');
          }
          if (
            ticket.name !== attachment.name ||
            ticket.mimeType !== attachment.mimeType ||
            ticket.sizeBytes !== attachment.sizeBytes ||
            ticket.kind !== attachment.kind
          ) {
            throw new Error('附件元数据与选择结果不一致，请重新选择附件。');
          }
        }
        const turnId = `turn-${crypto.randomUUID()}`;
        const taskId = `task-${crypto.randomUUID()}`;
        history.activeTurnId = turnId;
        history.turns.push({
          id: turnId,
          conversationId: history.conversation.id,
          sessionId,
          driver: 'builtin',
          model: {
            modelConfigurationId: model.id,
            modelConfigurationRevision: model.revision,
            modelConfigurationName: model.name,
            providerProfileId: provider.id,
            providerProfileRevision: provider.revision,
            providerProfileName: provider.name,
            protocol: provider.protocol,
            modelId: model.modelId,
            capabilities:
              model.validation.status === 'available'
                ? model.validation.capabilities
                : model.declaredCapabilities,
            contextWindowTokens: model.contextWindowTokens,
            maxOutputTokens: model.maxOutputTokens,
            autoCompact: model.autoCompact,
            compactThresholdPercent: model.compactThresholdPercent,
            supportedReasoningEfforts: model.supportedReasoningEfforts,
            defaultReasoningEffort: model.defaultReasoningEffort,
          },
          reasoningEffort: options.reasoningEffort ?? model.defaultReasoningEffort,
          permissionMode: history.conversation.permissionMode,
          userMessage: goal,
          status: 'running',
          revision: 1,
        });
        history.items.push({
          id: `item-${crypto.randomUUID()}`,
          conversationId: history.conversation.id,
          turnId,
          sequence: history.sequence++,
          type: 'user_text',
          content: goal,
          ...(attachments.length === 0
            ? {}
            : { attachments: attachments.map(toMockAttachmentMetadata) }),
        });
        for (const attachment of attachments) {
          attachmentTickets.delete(attachment.attachmentId);
        }
        recordMockAuditEvent({
          id: `audit-${taskId}-started`,
          type: 'task.started',
          sessionId,
          taskId,
          occurredAt: new Date().toISOString(),
          actor: { kind: 'user' },
          category: 'session',
          outcome: 'in_progress',
          risk: 'read_only',
          summary: 'Agent 任务开始',
        });
        emitTimeline({
          id: `timeline-${Date.now()}-user`,
          sessionId,
          kind: 'user',
          text: goal,
          ...(attachments.length === 0
            ? {}
            : { attachments: attachments.map(toMockAttachmentMetadata) }),
          conversationId: history.conversation.id,
          turnId,
          occurredAt: new Date().toISOString(),
        });
        const emitProgress = (
          phase: NonNullable<AgentTimelineItem['progress']>['phase'],
          revision: number,
          steps: NonNullable<AgentTimelineItem['progress']>['steps'],
        ): void => {
          emitTimeline({
            id: `mock-progress-${turnId}`,
            sessionId,
            kind: 'system',
            text: phase,
            status: phase,
            progress: { phase, revision, steps },
            conversationId: history!.conversation.id,
            turnId,
            occurredAt: new Date().toISOString(),
          });
        };
        const initialProgressDelayMs = searchParam('agentThinking') === '1' ? 250 : 0;
        const emitInitialProgress = (): void => {
          if (history!.activeTurnId !== turnId) return;
          emitProgress('planning', 0, [
            { id: 'mock-plan', label: '分析任务目标', status: 'running' },
          ]);
        };
        if (initialProgressDelayMs > 0) {
          globalThis.setTimeout(emitInitialProgress, initialProgressDelayMs);
        } else {
          emitInitialProgress();
        }
        if (searchParam('agentFailure') === '1') {
          globalThis.setTimeout(() => {
            if (history!.activeTurnId !== turnId) return;
            const activeTurn = history!.turns.find((turn) => turn.id === turnId);
            if (activeTurn !== undefined) activeTurn.status = 'failed';
            delete history!.activeTurnId;
            recordMockAuditEvent({
              id: `audit-${taskId}-failed`,
              type: 'task.failed',
              sessionId,
              taskId,
              occurredAt: new Date().toISOString(),
              actor: { kind: 'system' },
              category: 'session',
              outcome: 'failure',
              risk: 'read_only',
              summary: `Agent 执行失败：provider_stream_error: 424 (${goal})`,
              reason: 'provider_stream_error: 424',
            });
            emitProgress('failed', 1, [
              { id: 'mock-plan', label: '分析任务目标', status: 'failed' },
            ]);
            emitTimeline({
              id: `failure-${Date.now()}`,
              sessionId,
              kind: 'system',
              text: `Agent 执行失败：provider_stream_error: 424 (${goal})`,
              status: 'failed',
              conversationId: history!.conversation.id,
              turnId,
              occurredAt: new Date().toISOString(),
            });
          }, 100 + initialProgressDelayMs);
          return { taskId, conversationId: history.conversation.id, turnId };
        }
        if (/edit local file/i.test(goal)) {
          const approval = {
            id: `approval-${Date.now()}`,
            sessionId,
            conversationId: history.conversation.id,
            turnId,
            taskId,
            command: '编辑本机文件 notes/runbook.md',
            risk: 'mutating' as const,
            reasons: ['local file write changes filesystem state'],
            change: {
              path: 'notes/runbook.md',
              operation: 'edit' as const,
              beforeSha256: '1'.repeat(64),
              afterSha256: '2'.repeat(64),
              bytes: 48,
              diff: '@@ -1 +1 @@\n-旧的检查步骤\n+新的只读检查步骤',
              truncated: false,
            },
          };
          pendingApprovals.set(approval.id, approval);
          globalThis.setTimeout(() => {
            recordMockAuditEvent({
              id: `audit-${approval.id}-requested`,
              type: 'approval.requested',
              sessionId,
              taskId,
              occurredAt: new Date().toISOString(),
              actor: { kind: 'agent', taskId },
              category: 'approval',
              outcome: 'in_progress',
              risk: approval.risk,
              summary: `待审批：${approval.command}`,
              commandPreview: approval.command,
              reason: approval.reasons.join('；'),
            });
            emitProgress('waiting_approval', 1, [
              { id: 'mock-plan', label: '等待命令审批', status: 'waiting_approval' },
            ]);
            emitTimeline({
              id: approval.id,
              sessionId,
              kind: 'approval',
              text: approval.command,
              status: 'waiting_approval',
              risk: approval.risk,
              reasons: approval.reasons,
              change: approval.change,
              conversationId: history!.conversation.id,
              turnId,
              occurredAt: new Date().toISOString(),
            });
          }, 250 + initialProgressDelayMs);
          return { taskId, conversationId: history.conversation.id, turnId };
        }
        if (/\b(?:restart|delete|remove)\b/i.test(goal)) {
          const destructive = /\b(?:delete|remove)\b/i.test(goal);
          const approval = {
            id: `approval-${Date.now()}`,
            sessionId,
            conversationId: history.conversation.id,
            turnId,
            taskId,
            command: destructive ? 'rm -rf /tmp/cache' : 'systemctl restart api',
            risk: destructive ? ('destructive' as const) : ('mutating' as const),
            reasons: destructive
              ? ['command has irreversible or destructive semantics']
              : ['systemctl action changes service state'],
          };
          pendingApprovals.set(approval.id, approval);
          globalThis.setTimeout(() => {
            recordMockAuditEvent({
              id: `audit-${approval.id}-requested`,
              type: 'approval.requested',
              sessionId,
              taskId,
              occurredAt: new Date().toISOString(),
              actor: { kind: 'agent', taskId },
              category: 'approval',
              outcome: 'in_progress',
              risk: approval.risk,
              summary: `待审批：${approval.command}`,
              commandPreview: approval.command,
              reason: approval.reasons.join('；'),
            });
            emitProgress('waiting_approval', 1, [
              { id: 'mock-plan', label: '等待命令审批', status: 'waiting_approval' },
            ]);
            emitTimeline({
              id: approval.id,
              sessionId,
              kind: 'approval',
              text: approval.command,
              status: 'waiting_approval',
              risk: approval.risk,
              reasons: approval.reasons,
              conversationId: approval.conversationId,
              turnId: approval.turnId,
              occurredAt: new Date().toISOString(),
            });
          }, 250 + initialProgressDelayMs);
          return { taskId, conversationId: history.conversation.id, turnId };
        }
        const assistantText = /markdown/i.test(goal)
          ? '### 诊断结论\n\n| 资源 | 状态 |\n| --- | --- |\n| 磁盘 | 正常 |\n\n建议保留检查命令 `df -h`。\n\n[运行手册](https://example.com/runbook)\n\n<script>window.bad = true</script>'
          : '磁盘使用率正常，当前没有失败的 systemd 服务。';
        const commandId = `timeline-${Date.now()}-command`;
        const toolCallId = `tool-${Date.now()}-call`;
        const commandText = 'df -h && systemctl --failed --no-pager';
        const commandCompletionDelay =
          (searchParam('longCommand') === '1' ? 30_000 : 350) + initialProgressDelayMs;
        globalThis.setTimeout(() => {
          if (history!.activeTurnId !== turnId) return;
          emitProgress('executing', 1, [
            { id: 'mock-plan', label: '执行终端检查', status: 'running' },
          ]);
          runningCommands.set(sessionId, {
            id: commandId,
            text: commandText,
            taskId,
            turnId,
            conversationId: history!.conversation.id,
            toolCallId,
          });
          recordMockAuditEvent({
            id: `audit-${commandId}-running`,
            type: 'command.running',
            sessionId,
            taskId,
            occurredAt: new Date().toISOString(),
            actor: { kind: 'agent', taskId },
            category: 'command',
            outcome: 'in_progress',
            risk: 'read_only',
            summary: commandText,
            commandPreview: commandText,
            commandHash: 'sha256:mock-command',
            details: [{ label: '执行状态', value: 'running' }],
          });
          history!.items.push({
            id: `item-${crypto.randomUUID()}`,
            conversationId: history!.conversation.id,
            turnId,
            sequence: history!.sequence++,
            type: 'assistant_tool_call',
            toolCallId,
            name: 'terminal_execute',
            argumentsJson: JSON.stringify({ command: commandText }),
          });
          emitTimeline({
            id: `tool-call-${toolCallId}`,
            sessionId,
            kind: 'tool',
            toolRole: 'call',
            toolCallId,
            text: `terminal_execute\n${JSON.stringify({ command: commandText })}`,
            status: 'running',
            conversationId: history!.conversation.id,
            turnId,
            occurredAt: new Date().toISOString(),
          });
          emitTimeline({
            id: commandId,
            sessionId,
            kind: 'command',
            toolCallId,
            text: commandText,
            status: 'running',
            conversationId: history!.conversation.id,
            turnId,
            occurredAt: new Date().toISOString(),
          });
        }, 100);
        globalThis.setTimeout(() => {
          if (history!.activeTurnId !== turnId) return;
          if (runningCommands.get(sessionId)?.id !== commandId) return;
          runningCommands.delete(sessionId);
          recordMockAuditEvent({
            id: `audit-${commandId}-completed`,
            type: 'command.completed',
            sessionId,
            taskId,
            occurredAt: new Date().toISOString(),
            actor: { kind: 'agent', taskId },
            category: 'command',
            outcome: 'success',
            risk: 'read_only',
            summary: commandText,
            commandPreview: commandText,
            commandHash: 'sha256:mock-command',
            exitCode: 0,
            details: [
              { label: '执行状态', value: 'completed' },
              { label: '执行方言', value: 'posix' },
            ],
          });
          emitProgress('verifying', 2, [
            { id: 'mock-plan', label: '复核检查结果', status: 'running' },
          ]);
          emitTimeline({
            id: commandId,
            sessionId,
            kind: 'command',
            toolCallId,
            text: commandText,
            status: 'completed',
            conversationId: history!.conversation.id,
            turnId,
            occurredAt: new Date().toISOString(),
          });
          history!.items.push({
            id: `item-${crypto.randomUUID()}`,
            conversationId: history!.conversation.id,
            turnId,
            sequence: history!.sequence++,
            type: 'tool_result',
            toolCallId,
            content: JSON.stringify({
              ok: true,
              result: { status: 'completed', command: commandText },
            }),
            isError: false,
          });
          emitTimeline({
            id: `tool-result-${toolCallId}`,
            sessionId,
            kind: 'tool',
            toolRole: 'result',
            toolCallId,
            text: JSON.stringify({
              ok: true,
              result: { status: 'completed', command: commandText },
            }),
            status: 'completed',
            conversationId: history!.conversation.id,
            turnId,
            occurredAt: new Date().toISOString(),
          });
          emitOutput(
            sessionId,
            '\r\nFilesystem      Size  Used Avail Use% Mounted on\r\n/dev/sda1       120G   63G   51G  56% /\r\n',
          );
        }, commandCompletionDelay);
        globalThis.setTimeout(() => {
          if (history!.activeTurnId !== turnId) return;
          history!.items.push({
            id: `item-${crypto.randomUUID()}`,
            conversationId: history!.conversation.id,
            turnId,
            sequence: history!.sequence++,
            type: 'assistant_text',
            content: assistantText,
          });
          history!.turns.find((turn) => turn.id === turnId)!.status = 'completed';
          delete history!.activeTurnId;
          recordMockAuditEvent({
            id: `audit-${taskId}-completed`,
            type: 'task.completed',
            sessionId,
            taskId,
            occurredAt: new Date().toISOString(),
            actor: { kind: 'system' },
            category: 'session',
            outcome: 'success',
            risk: 'read_only',
            summary: 'Agent 任务完成',
          });
          emitProgress('completed', 3, [
            { id: 'mock-plan', label: '复核检查结果', status: 'completed' },
          ]);
          emitTimeline({
            id: `timeline-${Date.now()}-assistant`,
            sessionId,
            kind: 'assistant',
            text: assistantText,
            status: 'completed',
            conversationId: history!.conversation.id,
            turnId,
            occurredAt: new Date().toISOString(),
          });
        }, commandCompletionDelay + 350);
        return { taskId, conversationId: history.conversation.id, turnId };
      },
      cancel: async (sessionId, turnId) => {
        const history = conversations.get(sessionId);
        runningCommands.delete(sessionId);
        if (
          history?.activeTurnId !== undefined &&
          (turnId === undefined || history.activeTurnId === turnId)
        ) {
          const active = history.turns.find((turn) => turn.id === history.activeTurnId);
          const activeTurnId = history.activeTurnId;
          if (active !== undefined) active.status = 'cancelled';
          delete history.activeTurnId;
          recordMockAuditEvent({
            id: `audit-${activeTurnId}-cancelled`,
            type: 'task.cancelled',
            sessionId,
            occurredAt: new Date().toISOString(),
            actor: { kind: 'user' },
            category: 'session',
            outcome: 'interrupted',
            risk: 'read_only',
            summary: 'Agent 任务已取消',
          });
          emitTimeline({
            id: `mock-progress-${activeTurnId}`,
            sessionId,
            kind: 'system',
            text: 'cancelled',
            status: 'cancelled',
            progress: {
              phase: 'cancelled',
              revision: 2,
              steps: [{ id: 'mock-plan', label: '当前任务', status: 'cancelled' }],
            },
            conversationId: history.conversation.id,
            turnId: activeTurnId,
            occurredAt: new Date().toISOString(),
          });
          emitTimeline({
            id: `cancel-${Date.now()}`,
            sessionId,
            kind: 'system',
            text: '当前任务已取消',
            status: 'cancelled',
            conversationId: history.conversation.id,
            turnId: activeTurnId,
            occurredAt: new Date().toISOString(),
          });
        }
        const pending = [...pendingApprovals.values()].find(
          (approval) => approval.sessionId === sessionId,
        );
        if (pending === undefined) return;
        pendingApprovals.delete(pending.id);
        emitTimeline({
          id: pending.id,
          sessionId,
          kind: 'approval',
          text: pending.command,
          status: 'cancelled',
          risk: pending.risk,
          reasons: pending.reasons,
          conversationId: pending.conversationId,
          turnId: pending.turnId,
          ...(pending.change === undefined ? {} : { change: pending.change }),
          occurredAt: new Date().toISOString(),
        });
      },
      history: async (sessionId) => {
        historyCalls += 1;
        const historyErrorAfter = Number(
          searchParam('historyErrorAfter') ?? Number.POSITIVE_INFINITY,
        );
        if (Number.isFinite(historyErrorAfter) && historyCalls > historyErrorAfter) {
          throw new Error('Core request timed out: agent.history');
        }
        const history = conversations.get(sessionId);
        const snapshot =
          history === undefined
            ? { sessionId, turns: [], items: [] }
            : structuredClone({
                sessionId,
                conversation: history.conversation,
                turns: history.turns,
                items: history.items,
                ...(history.activeTurnId === undefined
                  ? {}
                  : { activeTurnId: history.activeTurnId }),
              });
        const delayMs =
          typeof globalThis.location === 'undefined'
            ? 0
            : Number(new URLSearchParams(globalThis.location.search).get('historyDelayMs') ?? '0');
        if (Number.isFinite(delayMs) && delayMs > 0) {
          await new Promise((resolve) => globalThis.setTimeout(resolve, Math.min(delayMs, 2_000)));
        }
        return snapshot;
      },
      resetConversation: async (sessionId, expectedConversationId) => {
        const history = conversations.get(sessionId);
        if (history === undefined || history.conversation.id !== expectedConversationId) {
          throw new Error('对话已变化，请刷新后重试');
        }
        if (history.activeTurnId !== undefined) throw new Error('活动任务期间不能重置对话');
        conversations.delete(sessionId);
        emitTimeline({
          id: `reset-${Date.now()}`,
          sessionId,
          kind: 'system',
          text: '对话已重置',
          status: 'completed',
          conversationId: history.conversation.id,
          occurredAt: new Date().toISOString(),
        });
      },
      interrupt: async (sessionId, transactionId) => {
        const running = runningCommands.get(sessionId);
        const history = conversations.get(sessionId);
        if (
          running !== undefined &&
          transactionId !== 'active-transaction' &&
          transactionId !== running.id
        ) {
          return;
        }
        if (running !== undefined) {
          runningCommands.delete(sessionId);
          const taskIdForAudit = running.taskId;
          recordMockAuditEvent({
            id: `audit-${running.id}-interrupted`,
            type: 'command.interrupted',
            sessionId,
            ...(taskIdForAudit === undefined ? {} : { taskId: taskIdForAudit }),
            occurredAt: new Date().toISOString(),
            actor:
              taskIdForAudit === undefined
                ? { kind: 'system' }
                : { kind: 'agent', taskId: taskIdForAudit },
            category: 'command',
            outcome: 'interrupted',
            risk: 'read_only',
            summary: running.text,
            commandPreview: running.text,
            commandHash: 'sha256:mock-command',
            reason: 'user requested interrupt',
          });
          emitTimeline({
            id: running.id,
            sessionId,
            kind: 'command',
            text: running.text,
            status: 'interrupted',
            conversationId: running.conversationId,
            turnId: running.turnId,
            toolCallId: running.toolCallId,
            occurredAt: new Date().toISOString(),
          });
        }
        emitTimeline({
          id: `interrupt-${Date.now()}`,
          sessionId,
          kind: 'system',
          text: '命令已中断',
          status: 'interrupted',
          ...(history === undefined ? {} : { conversationId: history.conversation.id }),
          ...(history?.activeTurnId === undefined ? {} : { turnId: history.activeTurnId }),
          occurredAt: new Date().toISOString(),
        });
      },
      approve: async (sessionId, approvalId, confirmedDestructive) => {
        const pending = pendingApprovals.get(approvalId);
        if (pending === undefined || pending.sessionId !== sessionId) return;
        if (pending.risk === 'destructive' && !confirmedDestructive) {
          throw new Error('破坏性操作需要二次确认');
        }
        if (searchParam('approvalStale') === '1') {
          pendingApprovals.delete(approvalId);
          const history = conversations.get(sessionId);
          if (history?.activeTurnId === pending.turnId) {
            history.turns.find((turn) => turn.id === pending.turnId)!.status = 'cancelled';
            delete history.activeTurnId;
          }
          throw new Error('Approval is no longer pending');
        }
        if (searchParam('approvalError') === '1') {
          throw new Error('模拟审批失败');
        }
        pendingApprovals.delete(approvalId);
        recordMockAuditEvent({
          id: `audit-${approvalId}-granted`,
          type: 'approval.granted',
          sessionId,
          taskId: pending.taskId,
          occurredAt: new Date().toISOString(),
          actor: { kind: 'user' },
          category: 'approval',
          outcome: 'success',
          risk: pending.risk,
          summary: `已批准：${pending.command}`,
          commandPreview: pending.command,
          details: [{ label: '确认破坏性操作', value: String(confirmedDestructive) }],
        });
        emitTimeline({
          id: approvalId,
          sessionId,
          kind: 'approval',
          text: pending.command,
          status: 'completed',
          risk: pending.risk,
          reasons: pending.reasons,
          conversationId: pending.conversationId,
          turnId: pending.turnId,
          ...(pending.change === undefined ? {} : { change: pending.change }),
          occurredAt: new Date().toISOString(),
        });
        emitTimeline({
          id: `mock-progress-${pending.turnId}`,
          sessionId,
          kind: 'system',
          text: 'completed',
          status: 'completed',
          progress: {
            phase: 'completed',
            revision: 2,
            steps: [{ id: 'mock-plan', label: '命令审批', status: 'completed' }],
          },
          conversationId: pending.conversationId,
          turnId: pending.turnId,
          occurredAt: new Date().toISOString(),
        });
        const history = conversations.get(sessionId);
        const activeTurn = history?.turns.find((turn) => turn.id === history.activeTurnId);
        if (activeTurn !== undefined) activeTurn.status = 'completed';
        if (history !== undefined) delete history.activeTurnId;
        recordMockAuditEvent({
          id: `audit-${approvalId}-completed`,
          type: 'command.completed',
          sessionId,
          taskId: pending.taskId,
          occurredAt: new Date().toISOString(),
          actor: { kind: 'agent', taskId: pending.taskId },
          category: 'command',
          outcome: 'success',
          risk: pending.risk,
          summary: pending.command,
          commandPreview: pending.command,
          commandHash: 'sha256:mock-approved-command',
          exitCode: 0,
          details: [{ label: '执行状态', value: 'completed' }],
        });
        recordMockAuditEvent({
          id: `audit-${pending.turnId}-completed`,
          type: 'task.completed',
          sessionId,
          taskId: pending.taskId,
          occurredAt: new Date().toISOString(),
          actor: { kind: 'system' },
          category: 'session',
          outcome: 'success',
          risk: pending.risk,
          summary: 'Agent 任务完成',
        });
        emitTimeline({
          id: `command-${Date.now()}`,
          sessionId,
          kind: 'command',
          text: pending.command,
          status: 'completed',
          conversationId: pending.conversationId,
          turnId: pending.turnId,
          occurredAt: new Date().toISOString(),
        });
        emitTimeline({
          id: `assistant-${Date.now()}`,
          sessionId,
          kind: 'assistant',
          text: '服务重启已完成。',
          status: 'completed',
          conversationId: pending.conversationId,
          turnId: pending.turnId,
          occurredAt: new Date().toISOString(),
        });
      },
      takeover: async (sessionId) => {
        const history = conversations.get(sessionId);
        const activeTurn = history?.turns.find((turn) => turn.id === history.activeTurnId);
        const activeTurnId = history?.activeTurnId;
        if (activeTurn !== undefined) activeTurn.status = 'cancelled';
        if (history !== undefined) delete history.activeTurnId;
        for (const approval of [...pendingApprovals.values()]) {
          if (approval.sessionId !== sessionId) continue;
          pendingApprovals.delete(approval.id);
          recordMockAuditEvent({
            id: `audit-${approval.id}-rejected`,
            type: 'approval.rejected',
            sessionId,
            taskId: approval.taskId,
            occurredAt: new Date().toISOString(),
            actor: { kind: 'user' },
            category: 'approval',
            outcome: 'rejected',
            risk: approval.risk,
            summary: `已拒绝：${approval.command}`,
            commandPreview: approval.command,
            reason: '用户接管并拒绝待审批操作',
          });
          emitTimeline({
            id: approval.id,
            sessionId,
            kind: 'approval',
            text: approval.command,
            status: 'cancelled',
            risk: approval.risk,
            reasons: approval.reasons,
            conversationId: approval.conversationId,
            turnId: approval.turnId,
            ...(approval.change === undefined ? {} : { change: approval.change }),
            occurredAt: new Date().toISOString(),
          });
        }
        emitTimeline({
          id: `takeover-${Date.now()}`,
          sessionId,
          kind: 'system',
          text: '已进入人工接管状态',
          status: 'waiting_user',
          ...(history === undefined ? {} : { conversationId: history.conversation.id }),
          ...(activeTurnId === undefined ? {} : { turnId: activeTurnId }),
          occurredAt: new Date().toISOString(),
        });
      },
      onTimeline: (listener) => {
        timelineListeners.add(listener);
        return () => timelineListeners.delete(listener);
      },
      onTextDelta: (listener) => {
        textDeltaListeners.add(listener);
        return () => textDeltaListeners.delete(listener);
      },
    },
    providers: {
      list: async () => structuredClone(providers),
      save: async (profile, apiKey) => {
        const current = providers.find((item) => item.id === profile.id);
        const next: ProviderProfileView = {
          ...profile,
          credentialConfigured: current?.credentialConfigured === true || Boolean(apiKey),
          revision: (current?.revision ?? 0) + 1,
        };
        const index = providers.findIndex((item) => item.id === profile.id);
        if (index < 0) providers.push(next);
        else providers[index] = next;
        if (current !== undefined && providerConnectionChanged(current, next)) {
          for (const model of models.filter((item) => item.providerProfileId === profile.id)) {
            model.status = 'unverified';
            model.validation = { status: 'unverified' };
            model.revision += 1;
          }
        }
      },
      discoverModels: async (providerId) => {
        const provider = providers.find((item) => item.id === providerId);
        if (provider === undefined) throw new Error('Provider 不存在');
        const request = { cancelled: false };
        discoveryRequests.set(providerId, request);
        await new Promise((resolve) => globalThis.setTimeout(resolve, 350));
        if (request.cancelled) throw new Error('模型发现已取消');
        if (discoveryRequests.get(providerId) === request) discoveryRequests.delete(providerId);
        return {
          providerProfileId: providerId,
          models: [
            { id: 'gpt-5-nano', displayName: 'GPT-5 nano' },
            { id: 'mimo-v2.5-pro', displayName: 'MiMo V2.5 Pro' },
            { id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5' },
          ],
          truncated: false,
        };
      },
      cancelDiscovery: async (providerId) => {
        const request = discoveryRequests.get(providerId);
        if (request === undefined) return false;
        request.cancelled = true;
        discoveryRequests.delete(providerId);
        return true;
      },
      remove: async (providerId) => {
        if (models.some((model) => model.providerProfileId === providerId)) {
          throw new Error('该 Provider 仍被模型配置引用');
        }
        const index = providers.findIndex((item) => item.id === providerId);
        if (index < 0) return false;
        providers.splice(index, 1);
        return true;
      },
    },
    models: {
      list: async () => structuredClone(models),
      save: async (input) => {
        const provider = providers.find((item) => item.id === input.providerProfileId);
        if (provider === undefined) throw new Error('Provider 不存在');
        const index = models.findIndex((item) => item.id === input.id);
        if (index < 0) {
          models.push(createUnverifiedModel(input, provider));
          return;
        }
        const current = models[index]!;
        if (current.providerProfileId !== input.providerProfileId) {
          throw new Error('已有模型不能更换 Provider');
        }
        const connectionChanged =
          current.modelId !== input.modelId ||
          current.contextWindowTokens !== input.contextWindowTokens ||
          current.maxOutputTokens !== input.maxOutputTokens ||
          current.declaredCapabilities.responses !== input.declaredCapabilities.responses ||
          current.declaredCapabilities.streaming !== input.declaredCapabilities.streaming ||
          current.declaredCapabilities.toolCalls !== input.declaredCapabilities.toolCalls ||
          current.declaredCapabilities.multimodal !== input.declaredCapabilities.multimodal;
        models[index] = {
          ...current,
          name: input.name,
          modelId: input.modelId,
          declaredCapabilities: input.declaredCapabilities,
          contextWindowTokens: input.contextWindowTokens,
          maxOutputTokens: input.maxOutputTokens,
          autoCompact: input.autoCompact,
          compactThresholdPercent: input.compactThresholdPercent,
          supportedReasoningEfforts: input.supportedReasoningEfforts,
          defaultReasoningEffort: input.defaultReasoningEffort,
          revision: current.revision + 1,
          ...(connectionChanged
            ? {
                status: 'unverified' as const,
                validation: { status: 'unverified' as const },
              }
            : {}),
        };
      },
      test: async (modelConfigurationId) => {
        const model = requireMockModel(models, modelConfigurationId);
        const provider = providers.find((item) => item.id === model.providerProfileId);
        if (provider === undefined) throw new Error('Provider 不存在');
        await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
        const attempt = 'attempt' in model.validation ? model.validation.attempt + 1 : 1;
        if (/^https:\/\/(127\.0\.0\.1|localhost)(?::|\/|$)/i.test(provider.baseUrl)) {
          model.status = 'unavailable';
          model.validation = {
            status: 'unavailable',
            checkedAt: new Date().toISOString(),
            attempt,
            reason: 'url_scheme_mismatch: wrong version number',
          };
        } else if (searchParam('modelTestUnavailable') === '1') {
          // E2E：模拟校验失败（请求成功但模型不可用）
          model.status = 'unavailable';
          model.validation = {
            status: 'unavailable',
            checkedAt: new Date().toISOString(),
            attempt,
            reason: 'model_not_found: 模型不存在',
          };
        } else {
          model.status = 'available';
          model.validation = {
            status: 'available',
            checkedAt: new Date().toISOString(),
            attempt,
            capabilities: {
              responses: true,
              streaming: true,
              toolCalls: true,
              multimodal: model.declaredCapabilities.multimodal === true,
            },
          };
        }
        model.revision += 1;
        return structuredClone(model);
      },
      setEnabled: async (modelConfigurationId, enabled) => {
        const model = requireMockModel(models, modelConfigurationId);
        if (searchParam('modelEnableError') === '1') {
          // E2E：模拟启用失败，用于验证乐观更新回滚
          await new Promise((resolve) => globalThis.setTimeout(resolve, 150));
          throw new Error('启用失败（模拟）');
        }
        model.enabled = enabled;
        if (!enabled) model.isDefault = false;
        model.revision += 1;
        return structuredClone(model);
      },
      setDefault: async (modelConfigurationId, isDefault) => {
        const model = requireMockModel(models, modelConfigurationId);
        if (isDefault && !model.enabled) throw new Error('只能将已启用模型设为默认');
        for (const item of models) item.isDefault = isDefault && item.id === modelConfigurationId;
        model.revision += 1;
        return structuredClone(model);
      },
      remove: async (modelConfigurationId) => {
        const index = models.findIndex((item) => item.id === modelConfigurationId);
        if (index < 0) return false;
        models.splice(index, 1);
        return true;
      },
      importDiscovered: async (providerProfileId, modelIds) => {
        const provider = providers.find((item) => item.id === providerProfileId);
        if (provider === undefined) throw new Error('Provider 不存在');
        const created: string[] = [];
        const skipped: string[] = [];
        for (const modelId of [...new Set(modelIds)]) {
          if (
            models.some(
              (model) => model.providerProfileId === providerProfileId && model.modelId === modelId,
            )
          ) {
            skipped.push(modelId);
            continue;
          }
          const id = `model-${crypto.randomUUID()}`;
          models.push(
            createUnverifiedModel(
              {
                id,
                name: modelId,
                providerProfileId,
                modelId,
                declaredCapabilities: {
                  responses: true,
                  streaming: true,
                  toolCalls: true,
                  multimodal: false,
                },
                contextWindowTokens: 128_000,
                maxOutputTokens: 4_096,
                autoCompact: true,
                compactThresholdPercent: 80,
                supportedReasoningEfforts: ['low', 'medium', 'high'],
                defaultReasoningEffort: 'medium',
              },
              provider,
            ),
          );
          created.push(id);
        }
        return { created, skipped };
      },
    },
    audit: {
      list: async (filter: AuditListRequest = {}): Promise<AuditListResponse> => {
        if (searchParam('auditTraceCalls') === '1' && typeof window !== 'undefined') {
          window.dispatchEvent(new Event('mock-audit-list-call'));
        }
        const configuredDelayMs = Number(searchParam('auditDelayMs') ?? '0');
        const delayedSessionId = searchParam('auditDelaySessionId');
        const delayMs =
          delayedSessionId === undefined || filter?.sessionId === delayedSessionId
            ? configuredDelayMs
            : 0;
        if (Number.isFinite(delayMs) && delayMs > 0) {
          await new Promise((resolve) => globalThis.setTimeout(resolve, Math.min(delayMs, 2_000)));
        }
        if (searchParam('auditError') === '1') throw new Error('审计事件暂时不可用');
        const search = filter.search?.trim().toLocaleLowerCase();
        const actorFilter = filter.actor?.trim().toLocaleLowerCase();
        const items = audit
          .filter((trace) => {
            if (filter.from !== undefined && trace.lastActivityAt < filter.from) return false;
            if (filter.to !== undefined && trace.startedAt > filter.to) return false;
            if (filter.sessionId !== undefined && trace.sessionId !== filter.sessionId)
              return false;
            if (filter.taskId !== undefined && trace.taskId !== filter.taskId) return false;
            if (filter.category !== undefined && trace.category !== filter.category) return false;
            if (filter.outcome !== undefined && trace.outcome !== filter.outcome) return false;
            if (filter.risk !== undefined && trace.risk !== filter.risk) return false;
            if (
              !filter.includeObservations &&
              trace.containsObservations &&
              trace.outcome === 'information'
            )
              return false;
            if (actorFilter !== undefined && actorFilter.length > 0) {
              const actorText = [
                trace.actor.kind,
                ...(trace.actor.kind === 'agent' ? [trace.actor.taskId] : []),
                ...(trace.actor.kind === 'external'
                  ? [trace.actor.callerKind, trace.actor.callerId]
                  : []),
              ]
                .filter((value): value is string => value !== undefined)
                .join(' ')
                .toLocaleLowerCase();
              if (!actorText.includes(actorFilter)) return false;
            }
            if (search !== undefined && search.length > 0) {
              const searchable = [
                trace.traceId,
                trace.sessionId,
                trace.taskId,
                trace.transactionId,
                trace.summary,
              ]
                .filter((value): value is string => value !== undefined)
                .join(' ')
                .toLocaleLowerCase();
              if (!searchable.includes(search)) return false;
            }
            return true;
          })
          .sort(
            (left, right) =>
              right.lastActivityAt.localeCompare(left.lastActivityAt) ||
              right.traceId.localeCompare(left.traceId),
          );
        const offset = parseMockAuditCursor(filter.cursor);
        const limit = filter.limit ?? 50;
        const page = items.slice(offset, offset + limit);
        return structuredClone({
          items: page,
          ...(offset + page.length < items.length
            ? { nextCursor: String(offset + page.length) }
            : {}),
        });
      },
      detail: async (traceId): Promise<AuditTraceDetailView | undefined> => {
        if (searchParam('auditError') === '1') throw new Error('审计事件暂时不可用');
        return structuredClone(auditDetails.find((detail) => detail.traceId === traceId));
      },
      retention: async () => ({ auditRetentionDays: 30, rawLogRetentionHours: 24 }),
      cleanup: async () => ({ rawLogs: 0, auditEvents: 0 }),
    },
    mcp: (() => {
      // 演示用的内存状态：mock 场景默认关闭、read-only、无 token。
      let enabled = false;
      let running = false;
      let approvalMode: McpApprovalMode = 'read_only';
      let token: string | undefined;
      return {
        status: async () => ({
          enabled,
          running,
          approvalMode,
          hasToken: token !== undefined,
          ...(token === undefined ? {} : { token }),
          ...(running ? { port: 18789, connectionString: 'http://127.0.0.1:18789/mcp' } : {}),
        }),
        setEnabled: async (next) => {
          await new Promise((resolve) => globalThis.setTimeout(resolve, 400));
          if (next && token === undefined) token = 'mock-token';
          enabled = next;
          running = next && token !== undefined;
          return {
            enabled,
            running,
            approvalMode,
            hasToken: token !== undefined,
            ...(token === undefined ? {} : { token }),
            ...(running ? { port: 18789, connectionString: 'http://127.0.0.1:18789/mcp' } : {}),
          };
        },
        setApprovalMode: async (mode) => {
          approvalMode = mode;
          return {
            enabled,
            running,
            approvalMode,
            hasToken: token !== undefined,
            ...(token === undefined ? {} : { token }),
            ...(running ? { port: 18789, connectionString: 'http://127.0.0.1:18789/mcp' } : {}),
          };
        },
        regenerateToken: async () => {
          token = 'mock-token-new';
          return {
            enabled,
            running,
            approvalMode,
            hasToken: token !== undefined,
            ...(token === undefined ? {} : { token }),
            ...(running ? { port: 18789, connectionString: 'http://127.0.0.1:18789/mcp' } : {}),
          };
        },
        revokeToken: async () => {
          token = undefined;
          running = false;
          return { enabled, running, approvalMode, hasToken: false };
        },
      };
    })(),
    acp: (() => {
      // 演示用的内存状态：mock 场景默认关闭、managed 审批、无活动会话。
      let enabled = false;
      let running = false;
      let approvalMode: 'managed' | 'manual' = 'managed';
      let activeSessionId: string | undefined;
      let activeTurn = false;
      const statusListeners: Array<(status: AcpStatus) => void> = [];
      const histories = new Map<
        string,
        { turns: AcpTurnView[]; projection: AcpHistoryView['projection'] }
      >();
      const toStatus = () => ({
        enabled,
        running,
        approvalMode,
        ...(activeSessionId === undefined ? {} : { activeSessionId }),
        activeTurn,
        agentName: 'opencode',
      });
      const emitStatus = () => {
        const status = toStatus();
        for (const listener of statusListeners) listener(status);
      };
      return {
        status: async () => toStatus(),
        setEnabled: async (next) => {
          await new Promise((resolve) => globalThis.setTimeout(resolve, 400));
          enabled = next;
          if (!next) {
            running = false;
            activeTurn = false;
            activeSessionId = undefined;
          }
          emitStatus();
          return toStatus();
        },
        setApprovalMode: async (mode) => {
          approvalMode = mode;
          return toStatus();
        },
        startTurn: async (sessionId, goal) => {
          if (!enabled) throw new Error('ACP 集成未启用：请先在设置页打开“允许 ACP 集成”');
          running = true;
          activeSessionId = sessionId;
          activeTurn = true;
          const conversationId = `acp-conv-${sessionId}`;
          const turnId = `acp-turn-${Date.now()}`;
          emitTimeline({
            id: `acp-user-${Date.now()}`,
            sessionId,
            kind: 'user',
            text: goal,
            conversationId,
            turnId,
            occurredAt: new Date().toISOString(),
          });
          histories.set(sessionId, {
            turns: [
              {
                id: turnId,
                conversationId,
                sessionId,
                driver: 'acp',
                userMessage: goal,
                status: 'running',
                revision: 1,
                occurredAt: new Date().toISOString(),
              },
            ],
            projection: { userText: [goal], assistantText: [], toolCalls: [] },
          });
          emitStatus();
          return { turnId, conversationId };
        },
        cancelTurn: async () => {
          activeTurn = false;
          emitStatus();
        },
        respondApproval: async () => undefined,
        closeConversation: async (sessionId) => {
          if (activeSessionId === sessionId) {
            activeTurn = false;
            running = false;
            activeSessionId = undefined;
            emitStatus();
          }
        },
        history: async (sessionId) => {
          const history = histories.get(sessionId);
          return {
            sessionId,
            ...(history === undefined
              ? { turns: [], projection: { userText: [], assistantText: [], toolCalls: [] } }
              : history),
          };
        },
        onStatusChanged: (listener) => {
          statusListeners.push(listener);
          return () => {
            const index = statusListeners.indexOf(listener);
            if (index >= 0) statusListeners.splice(index, 1);
          };
        },
      };
    })(),
    core: {
      status: async () => {
        if (
          typeof globalThis.location !== 'undefined' &&
          new URLSearchParams(globalThis.location.search).get('coreError') === 'version'
        ) {
          throw new Error('Core 协议版本不兼容');
        }
        return {
          connected: coreConnected,
          version: '0.1.0-dev',
          sessions: sessions.length,
          agentTasks: 0,
        };
      },
      exit: async (mode) => {
        if (mode === 'terminate_sessions') sessions.splice(0, sessions.length);
        coreConnected = false;
      },
    },
  };
}

function parseMockAuditCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const offset = Number(cursor);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
}

function isEligibleModel(model: ModelConfigurationView): boolean {
  return model.enabled;
}

function toMockAttachmentMetadata(attachment: PickedAgentAttachment) {
  return {
    id: attachment.attachmentId,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    kind: attachment.kind,
    ...(attachment.kind === 'file' ? { relativePath: attachment.name } : {}),
  };
}

function createUnverifiedModel(
  input: ModelConfigurationInput,
  provider: ProviderProfileView,
): ModelConfigurationView {
  return {
    ...input,
    providerName: provider.name,
    providerProtocol: provider.protocol,
    enabled: false,
    isDefault: false,
    status: 'unverified',
    validation: { status: 'unverified' },
    revision: 1,
  };
}

function requireMockModel(
  models: ModelConfigurationView[],
  modelConfigurationId: string,
): ModelConfigurationView {
  const model = models.find((item) => item.id === modelConfigurationId);
  if (model === undefined) throw new Error('模型配置不存在');
  return model;
}

function providerConnectionChanged(
  current: ProviderProfileView,
  next: ProviderProfileView,
): boolean {
  return (
    current.protocol !== next.protocol ||
    current.baseUrl !== next.baseUrl ||
    current.timeoutMs !== next.timeoutMs ||
    JSON.stringify(current.extraHeaders ?? {}) !== JSON.stringify(next.extraHeaders ?? {})
  );
}

function createMockResourceSnapshot(
  dialect: SessionResourceSnapshot['dialect'],
  partial = false,
): SessionResourceSnapshot {
  return {
    dialect,
    collectedAt: new Date().toISOString(),
    status: partial ? 'partial' : 'complete',
    host: { status: 'available', value: { name: 'api-prod' } },
    os: {
      status: 'available',
      value: { name: 'Linux', version: '6.8', architecture: 'x86_64' },
    },
    uptime: { status: 'available', value: { seconds: 342_000 } },
    cpu: partial
      ? { status: 'unavailable', reason: 'command_unavailable', message: 'CPU 指标不可用' }
      : {
          status: 'available',
          value: {
            logicalProcessors: 8,
            usagePercent: 23,
            loadAverage: { oneMinute: 0.72, fiveMinutes: 0.64, fifteenMinutes: 0.55 },
          },
        },
    memory: {
      status: 'available',
      value: { totalBytes: 16 * 1024 ** 3, usedBytes: Math.round(9.4 * 1024 ** 3) },
    },
    swap: {
      status: 'available',
      value: { totalBytes: 2 * 1024 ** 3, usedBytes: 128 * 1024 ** 2 },
    },
    disks: {
      status: 'available',
      value: [
        {
          name: '/dev/sda1',
          mountPoint: '/',
          totalBytes: 120 * 1024 ** 3,
          usedBytes: 63 * 1024 ** 3,
          usagePercent: 56,
        },
      ],
    },
    network: {
      status: 'available',
      value: [
        {
          name: 'eth0',
          receivedBytes: Math.round(6.2 * 1024 ** 3),
          transmittedBytes: Math.round(1.8 * 1024 ** 3),
        },
      ],
    },
  };
}
