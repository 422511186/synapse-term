import { describe, expect, it } from 'vitest';

import {
  agentTextDeltaSchema,
  coreApiUseCaseSchema,
  coreRequestSchema,
  coreServiceEventSchema,
  modelConfigurationViewSchema,
  parseCoreRequest,
  providerProfileViewSchema,
  sessionResourceRefreshResultSchema,
  sessionResourceSnapshotSchema,
  sessionSummarySchema,
  type CoreRequest,
} from './core-api.js';

describe('Core API protocol', () => {
  it('用例枚举与 coreRequestSchema.method 保持同源', () => {
    const methods = coreRequestSchema.options.map((option) => option.shape.method.value);
    expect(coreApiUseCaseSchema.options.sort()).toEqual([...methods].sort());
    expect(coreApiUseCaseSchema.parse('session.create')).toBe('session.create');
    expect(coreApiUseCaseSchema.parse('agent.start')).toBe('agent.start');
  });

  it('validates the narrow desktop request surface', () => {
    const request: CoreRequest = {
      method: 'session.create',
      payload: {
        title: 'production shell',
        terminalType: 'Git Bash',
        executable: 'bash.exe',
        args: ['--noprofile', '--norc', '-i'],
        cwd: 'C:/work',
        env: { TERM: 'xterm-256color' },
        columns: 120,
        rows: 40,
        executionDialect: 'posix',
      },
    };

    expect(coreRequestSchema.parse(request)).toEqual(request);
    expect(parseCoreRequest(request.method, request.payload)).toEqual(request);
    expect(() => parseCoreRequest('filesystem.read', { path: 'secret.txt' })).toThrow();
    expect(() =>
      parseCoreRequest('terminal.resize', {
        sessionId: 'session-1',
        columns: 0,
        rows: 24,
      }),
    ).toThrow();
    expect(
      parseCoreRequest('session.setDialect', {
        sessionId: 'session-1',
        executionDialect: 'powershell',
      }),
    ).toMatchObject({ method: 'session.setDialect' });
    expect(
      parseCoreRequest('agent.resetConversation', {
        sessionId: 'session-1',
        expectedConversationId: 'conversation-1',
      }),
    ).toMatchObject({ method: 'agent.resetConversation' });
    expect(
      parseCoreRequest('agent.start', {
        sessionId: 'session-1',
        goal: '检查服务',
        attachments: [
          {
            id: 'attachment-1',
            name: '截图.png',
            mimeType: 'image/png',
            sizeBytes: 1_024,
            kind: 'image',
            sourcePath: 'C:/tmp/a.png',
          },
        ],
        modelConfigurationId: 'model-1',
        reasoningEffort: 'high',
        permissionMode: 'manual',
      }),
    ).toMatchObject({
      method: 'agent.start',
      payload: {
        attachments: [expect.objectContaining({ id: 'attachment-1' })],
        modelConfigurationId: 'model-1',
        reasoningEffort: 'high',
        permissionMode: 'manual',
      },
    });
    expect(
      parseCoreRequest('agent.start', {
        sessionId: 'session-1',
        goal: '进行深度分析',
        modelConfigurationId: 'model-1',
        reasoningEffort: 'xhigh',
      }),
    ).toMatchObject({ payload: { reasoningEffort: 'xhigh' } });
    expect(() =>
      parseCoreRequest('agent.start', {
        sessionId: 'session-1',
        goal: '未知附件字段',
        attachments: [
          {
            id: 'attachment-1',
            name: 'notes.txt',
            mimeType: 'text/plain',
            sizeBytes: 1_024,
            kind: 'file',
            sourcePath: 'C:/tmp/notes.txt',
            unknownField: 'must-not-cross',
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseCoreRequest('agent.start', {
        sessionId: 'session-1',
        goal: 'legacy effort',
        modelConfigurationId: 'model-1',
        reasoningEffort: 'minimal',
      }),
    ).toThrow();
    expect(parseCoreRequest('agent.history', { sessionId: 'session-1' })).toMatchObject({
      method: 'agent.history',
    });
    expect(
      parseCoreRequest('agent.cancel', { sessionId: 'session-1', turnId: 'turn-1' }),
    ).toMatchObject({ payload: { turnId: 'turn-1' } });
    expect(parseCoreRequest('resources.refresh', { sessionId: 'session-1' })).toMatchObject({
      method: 'resources.refresh',
    });
    expect(parseCoreRequest('resources.get', { sessionId: 'session-1' })).toMatchObject({
      method: 'resources.get',
    });
  });

  it('preserves a bounded terminal type in Session launch and summary payloads', () => {
    const request = coreRequestSchema.safeParse({
      method: 'session.create',
      payload: {
        title: 'production shell',
        terminalType: 'Git Bash',
        executable: 'C:/Program Files/Git/bin/bash.exe',
        args: ['-i'],
        cwd: 'C:/work',
        env: { TERM: 'xterm-256color' },
        columns: 120,
        rows: 40,
        executionDialect: 'posix',
      },
    });

    expect(request.success).toBe(true);
    if (request.success) {
      expect(request.data).toMatchObject({ payload: { terminalType: 'Git Bash' } });
    }
    const summary = sessionSummarySchema.safeParse({
      id: 'session-1',
      title: 'production shell',
      terminalType: 'Git Bash',
      pty: 'running',
      shell: 'ready',
      executionDialect: 'posix',
    });
    expect(summary.success).toBe(true);
    if (summary.success) expect(summary.data).toMatchObject({ terminalType: 'Git Bash' });
    expect(() =>
      parseCoreRequest('session.create', {
        title: 'production shell',
        terminalType: 'x'.repeat(129),
        executable: 'bash',
        args: ['-i'],
        cwd: '/work',
        env: {},
        columns: 80,
        rows: 24,
        executionDialect: 'posix',
      }),
    ).toThrow();
  });

  it('keeps credentials write-only and out of provider views', () => {
    const save = parseCoreRequest('provider.save', {
      profile: {
        id: 'provider-1',
        name: 'Operations',
        protocol: 'openai_responses',
        baseUrl: 'https://api.openai.com/v1',
        extraHeaders: { 'x-tenant': 'operations' },
        timeoutMs: 45_000,
      },
      apiKey: 'secret-key',
    });

    expect(save).toMatchObject({
      method: 'provider.save',
      payload: {
        profile: {
          protocol: 'openai_responses',
          baseUrl: 'https://api.openai.com/v1',
        },
      },
    });
    expect(() =>
      parseCoreRequest('model.save', {
        model: {
          id: 'model-invalid-context',
          name: 'Invalid context',
          providerProfileId: 'provider-1',
          modelId: 'local-model',
          contextWindowTokens: 4_096,
          maxOutputTokens: 4_096,
          autoCompact: true,
          compactThresholdPercent: 80,
          supportedReasoningEfforts: ['low'],
          defaultReasoningEffort: 'low',
          declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
        },
      }),
    ).toThrow();
    expect(() =>
      parseCoreRequest('model.save', {
        model: {
          id: 'model-invalid-reasoning',
          name: 'Invalid reasoning',
          providerProfileId: 'provider-1',
          modelId: 'local-model',
          contextWindowTokens: 32_768,
          maxOutputTokens: 4_096,
          autoCompact: true,
          compactThresholdPercent: 80,
          supportedReasoningEfforts: ['low'],
          defaultReasoningEffort: 'high',
          declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
        },
      }),
    ).toThrow();
    expect(
      coreServiceEventSchema.parse({
        type: 'agent.text_delta',
        streamId: 'agent:session-1',
        payload: {
          id: 'assistant-1',
          sessionId: 'session-1',
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          operation: 'append',
          delta: 'hello',
          sequence: 0,
          occurredAt: '2026-07-27T00:00:00.000Z',
        },
      }),
    ).toMatchObject({
      type: 'agent.text_delta',
      payload: { id: 'assistant-1', operation: 'append', sequence: 0 },
    });
    expect(
      agentTextDeltaSchema.parse({
        id: 'assistant-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        operation: 'replace',
        delta: 'final',
        sequence: 1,
        occurredAt: '2026-07-27T00:00:00.000Z',
      }),
    ).toMatchObject({ operation: 'replace', delta: 'final' });
    expect(() =>
      agentTextDeltaSchema.parse({
        id: 'assistant-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        operation: 'append',
        delta: '',
        sequence: 2,
        occurredAt: '2026-07-27T00:00:00.000Z',
      }),
    ).toThrow();
    expect(() =>
      agentTextDeltaSchema.parse({
        id: 'assistant-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        operation: 'append',
        delta: 'bad',
        sequence: -1,
        occurredAt: '2026-07-27T00:00:00.000Z',
      }),
    ).toThrow();

    expect(
      coreServiceEventSchema.parse({
        type: 'agent.timeline',
        streamId: 'agent:session-1',
        payload: {
          id: 'timeline-1',
          sessionId: 'session-1',
          kind: 'assistant',
          text: 'Complete',
          occurredAt: '2026-07-27T00:00:00.000Z',
        },
      }),
    ).toMatchObject({ type: 'agent.timeline' });

    expect(
      coreServiceEventSchema.parse({
        type: 'agent.timeline',
        streamId: 'agent:session-1',
        payload: {
          id: 'timeline-tool-1',
          sessionId: 'session-1',
          kind: 'tool',
          text: 'terminal_observe',
          status: 'completed',
          occurredAt: '2026-07-27T00:00:00.000Z',
        },
      }),
    ).toMatchObject({ payload: { kind: 'tool' } });

    expect(
      coreServiceEventSchema.parse({
        type: 'agent.timeline',
        streamId: 'agent:session-1',
        payload: {
          id: 'approval-1',
          sessionId: 'session-1',
          kind: 'approval',
          text: 'rm -rf ./cache',
          status: 'waiting_approval',
          risk: 'destructive',
          reasons: ['command has irreversible or destructive semantics'],
          change: {
            path: 'project/config.json',
            operation: 'edit',
            beforeSha256: 'a'.repeat(64),
            afterSha256: 'b'.repeat(64),
            bytes: 42,
            diff: '--- a/project/config.json\n+++ b/project/config.json',
            truncated: false,
          },
          occurredAt: '2026-07-27T00:00:00.000Z',
        },
      }),
    ).toMatchObject({
      payload: {
        kind: 'approval',
        risk: 'destructive',
        change: { path: 'project/config.json', operation: 'edit' },
      },
    });

    const providerView = {
      id: 'provider-1',
      name: 'Operations',
      protocol: 'openai_responses' as const,
      baseUrl: 'https://api.openai.com/v1',
      extraHeaders: { 'x-tenant': 'operations' },
      timeoutMs: 45_000,
      credentialConfigured: true,
      revision: 2,
    };
    expect(providerProfileViewSchema.parse(providerView)).toEqual(providerView);
    expect(JSON.stringify(providerView)).not.toContain('secret-key');

    const modelView = {
      id: 'model-1',
      name: 'GPT-5',
      providerProfileId: 'provider-1',
      providerName: 'Operations',
      providerProtocol: 'openai_responses' as const,
      modelId: 'gpt-5',
      contextWindowTokens: 200_000,
      maxOutputTokens: 16_384,
      autoCompact: true,
      compactThresholdPercent: 75,
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'high',
      declaredCapabilities: { responses: true, streaming: true, toolCalls: true },
      enabled: true,
      isDefault: true,
      status: 'available',
      validation: {
        status: 'available',
        checkedAt: '2026-07-27T00:00:00.000Z',
        attempt: 1,
        capabilities: { responses: true, streaming: true, toolCalls: true },
      },
      revision: 4,
    };
    expect(modelConfigurationViewSchema.parse(modelView)).toEqual(modelView);
    expect(
      modelConfigurationViewSchema.parse({
        ...modelView,
        declaredCapabilities: {
          ...modelView.declaredCapabilities,
          multimodal: true,
        },
        validation: {
          ...modelView.validation,
          capabilities: {
            ...modelView.validation.capabilities,
            multimodal: true,
          },
        },
      }),
    ).toMatchObject({
      declaredCapabilities: { multimodal: true },
      validation: { capabilities: { multimodal: true } },
    });

    const resourceSnapshot = {
      dialect: 'posix' as const,
      collectedAt: '2026-07-28T00:00:00.000Z',
      status: 'partial' as const,
      host: { status: 'available' as const, value: { name: 'example-host' } },
      os: { status: 'available' as const, value: { name: 'Linux', architecture: 'x86_64' } },
      uptime: { status: 'available' as const, value: { seconds: 100 } },
      cpu: { status: 'available' as const, value: { logicalProcessors: 4, usagePercent: 20 } },
      memory: {
        status: 'available' as const,
        value: { totalBytes: 1000, usedBytes: 400, availableBytes: 600 },
      },
      swap: { status: 'available' as const, value: { totalBytes: 0, usedBytes: 0 } },
      disks: {
        status: 'available' as const,
        value: [{ name: '/dev/sda1', mountPoint: '/', totalBytes: 1000, usedBytes: 500 }],
      },
      network: {
        status: 'unavailable' as const,
        reason: 'command_unavailable' as const,
        message: '目标环境不支持该指标的只读采集命令',
      },
    };
    expect(sessionResourceSnapshotSchema.parse(resourceSnapshot)).toEqual(resourceSnapshot);
    expect(
      sessionResourceRefreshResultSchema.parse({ ok: true, snapshot: resourceSnapshot }),
    ).toEqual({ ok: true, snapshot: resourceSnapshot });
    expect(
      sessionResourceRefreshResultSchema.parse({
        ok: false,
        error: { code: 'session_not_ready', message: '终端会话当前无法安全刷新资源。' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'session_not_ready' } });
    expect(() =>
      sessionResourceSnapshotSchema.parse({
        ...resourceSnapshot,
        cpu: { status: 'available', value: { usagePercent: 101 } },
      }),
    ).toThrow();
    expect(
      coreServiceEventSchema.parse({
        type: 'session.resources',
        streamId: 'resources:session-1',
        payload: { sessionId: 'session-1', snapshot: resourceSnapshot },
      }),
    ).toMatchObject({ type: 'session.resources' });
  });

  it('accepts session.markShared and external tool calls with caller context', () => {
    expect(parseCoreRequest('session.markShared', { sessionId: 'session-1' })).toMatchObject({
      method: 'session.markShared',
      payload: { sessionId: 'session-1' },
    });
    expect(
      sessionSummarySchema.parse({
        id: 'session-1',
        title: 'production shell',
        terminalType: 'Git Bash',
        pty: 'running',
        shell: 'ready',
        executionDialect: 'posix',
        shared: true,
      }),
    ).toMatchObject({ shared: true });

    const caller = { kind: 'mcp' as const, id: 'mcp-client', displayName: 'Codex' };
    const base = { sessionId: 'session-1', approvalMode: 'managed' as const, caller };
    expect(parseCoreRequest('external.terminalExecute', { ...base, command: 'ls' })).toMatchObject({
      method: 'external.terminalExecute',
      payload: { command: 'ls' },
    });
    expect(
      parseCoreRequest('external.terminalExecute', {
        ...base,
        approvalMode: 'full',
        command: 'ls',
      }),
    ).toMatchObject({ method: 'external.terminalExecute' });
    expect(parseCoreRequest('external.terminalObserve', { ...base, view: 'output' })).toMatchObject(
      { method: 'external.terminalObserve' },
    );
    expect(
      parseCoreRequest('external.terminalWait', { ...base, transactionId: 'tx-1' }),
    ).toMatchObject({ method: 'external.terminalWait' });
    expect(
      parseCoreRequest('external.terminalInterrupt', { ...base, transactionId: 'tx-1' }),
    ).toMatchObject({ method: 'external.terminalInterrupt' });
    expect(parseCoreRequest('external.terminalStatus', { ...base })).toMatchObject({
      method: 'external.terminalStatus',
      payload: { sessionId: 'session-1' },
    });
    expect(parseCoreRequest('external.localListFiles', { ...base, path: 'src' })).toMatchObject({
      method: 'external.localListFiles',
    });
    expect(
      parseCoreRequest('external.localSearchFiles', {
        ...base,
        path: 'src',
        query: 'auth',
        mode: 'filename',
      }),
    ).toMatchObject({ method: 'external.localSearchFiles' });
    expect(
      parseCoreRequest('external.localReadFile', { ...base, path: 'src/main.ts' }),
    ).toMatchObject({ method: 'external.localReadFile' });
    expect(
      parseCoreRequest('external.classifyCommand', {
        sessionId: 'session-1',
        caller,
        approvalMode: 'managed',
        command: 'ls',
      }),
    ).toMatchObject({ method: 'external.classifyCommand' });
    expect(
      parseCoreRequest('external.recordRejection', {
        sessionId: 'session-1',
        caller,
        toolName: 'native_edit',
        reason: 'undeclared_capability',
      }),
    ).toMatchObject({ method: 'external.recordRejection' });

    expect(() =>
      parseCoreRequest('external.terminalExecute', {
        approvalMode: 'managed',
        caller,
        command: 'ls',
      }),
    ).toThrow();
    expect(() =>
      parseCoreRequest('external.terminalExecute', {
        ...base,
        approvalMode: 'manual',
        command: 'ls',
      }),
    ).toThrow();
    expect(() =>
      parseCoreRequest('external.classifyCommand', {
        sessionId: 'session-1',
        caller,
        approvalMode: 'read_only',
        command: 'ls',
      }),
    ).toThrow();
    expect(() => parseCoreRequest('external.terminalExecute', { ...base, command: '' })).toThrow();
  });
});
