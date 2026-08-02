import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { createModelConfiguration, createProviderProfile } from '@terminal-agent/domain';
import type { AgentTimelineItem } from '@terminal-agent/protocol';
import { FakePty, withTemporaryDirectory } from '@terminal-agent/test-kit';

import { AgentTaskScheduler } from './agent-task-scheduler.js';
import { CoreRepositories } from './repositories.js';
import { CORE_MIGRATIONS } from './core-schema.js';
import { AgentCoordinator } from './agent-coordinator.js';
import { ContextBuilder } from './context-builder.js';
import { PolicyEngine } from './policy-engine.js';
import { LocalFilePolicy } from './local-file-policy.js';
import { LocalFileService } from './local-file-service.js';
import { ModelCatalogService } from './model-catalog-service.js';
import { OutputJournal } from './output-journal.js';
import { ProviderProfileService } from './provider-profile-service.js';
import type { ModelAdapter, ModelEvent, ModelRequest } from './model-adapter.js';
import { SessionManager } from './session-manager.js';
import { SqliteStore } from './sqlite-store.js';

class ScriptedAdapter implements ModelAdapter {
  readonly requests: ModelRequest[] = [];
  #turn = 0;

  constructor(readonly command = 'printf ok') {}

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    this.#turn += 1;
    if (this.#turn > 1) {
      yield { type: 'text_delta', delta: 'Command completed.' };
      yield { type: 'turn_completed', stopReason: 'stop' };
      return;
    }
    yield { type: 'tool_call_started', id: 'call-1', name: 'terminal_execute' };
    yield {
      type: 'tool_call_completed',
      id: 'call-1',
      name: 'terminal_execute',
      argumentsJson: JSON.stringify({ command: this.command }),
    };
    yield { type: 'turn_completed', stopReason: 'tool_call' };
  }
}

class PartialCompletionAdapter implements ModelAdapter {
  readonly requests: ModelRequest[] = [];
  #turn = 0;

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    this.#turn += 1;
    if (this.#turn === 1 || this.#turn === 3) {
      const suffix = this.#turn === 1 ? 'first' : 'second';
      if (this.#turn === 1) yield { type: 'text_delta', delta: '开始执行检查。' };
      yield { type: 'tool_call_started', id: `call-${suffix}`, name: 'terminal_execute' };
      yield {
        type: 'tool_call_completed',
        id: `call-${suffix}`,
        name: 'terminal_execute',
        argumentsJson: JSON.stringify({ command: `printf ${suffix}` }),
      };
      yield { type: 'turn_completed', stopReason: 'tool_call' };
      return;
    }
    if (this.#turn === 2) {
      yield { type: 'text_delta', delta: '所有检查均已完成。' };
      yield { type: 'turn_completed', stopReason: 'stop' };
      return;
    }
    if (this.#turn === 4) {
      yield { type: 'text_delta', delta: '补充检查后完成。' };
      yield { type: 'turn_completed', stopReason: 'stop' };
      return;
    }
    yield { type: 'text_delta', delta: '已验证两个检查项均完成。' };
    yield { type: 'turn_completed', stopReason: 'stop' };
  }
}

class ApprovalAdapter implements ModelAdapter {
  readonly requests: ModelRequest[] = [];
  #turn = 0;

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    this.#turn += 1;
    if (this.#turn > 1) {
      yield { type: 'text_delta', delta: 'Approved command completed.' };
      yield { type: 'turn_completed', stopReason: 'stop' };
      return;
    }
    yield { type: 'tool_call_started', id: 'call-approval', name: 'terminal_execute' };
    yield {
      type: 'tool_call_completed',
      id: 'call-approval',
      name: 'terminal_execute',
      argumentsJson: '{"command":"touch /tmp/approved"}',
    };
    yield { type: 'turn_completed', stopReason: 'tool_call' };
  }
}

class ChatAdapter implements ModelAdapter {
  readonly requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', delta: '我可以和你对话，也可以按需调用终端或本机文件工具。' };
    yield { type: 'turn_completed', stopReason: 'stop' };
  }
}

class FailingAdapter implements ModelAdapter {
  async *stream(): AsyncIterable<ModelEvent> {
    yield {
      type: 'provider_error',
      code: 'connection_error',
      message: 'provider is unreachable',
      retryable: false,
    };
  }
}

class SensitiveLocalFileAdapter implements ModelAdapter {
  readonly requests: ModelRequest[] = [];
  #turn = 0;

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    this.#turn += 1;
    if (this.#turn === 1) {
      yield { type: 'tool_call_started', id: 'call-sensitive', name: 'local_read_file' };
      yield {
        type: 'tool_call_completed',
        id: 'call-sensitive',
        name: 'local_read_file',
        argumentsJson: '{"path":".ssh/id_ed25519"}',
      };
      yield { type: 'turn_completed', stopReason: 'tool_call' };
      return;
    }
    yield { type: 'text_delta', delta: '已完成敏感文件检查。' };
    yield { type: 'turn_completed', stopReason: 'stop' };
  }
}

class ObserveOutputAdapter implements ModelAdapter {
  readonly requests: ModelRequest[] = [];
  #turn = 0;

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    this.#turn += 1;
    if (this.#turn === 1) {
      yield { type: 'tool_call_started', id: 'call-observe', name: 'terminal_observe' };
      yield {
        type: 'tool_call_completed',
        id: 'call-observe',
        name: 'terminal_observe',
        argumentsJson: '{"view":"output","afterCursor":0}',
      };
      yield { type: 'turn_completed', stopReason: 'tool_call' };
      return;
    }
    yield { type: 'text_delta', delta: 'Observed the current Session output.' };
    yield { type: 'turn_completed', stopReason: 'stop' };
  }
}

class LocalEditApprovalAdapter implements ModelAdapter {
  readonly requests: ModelRequest[] = [];
  #turn = 0;

  constructor(readonly expectedSha256: string) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    this.#turn += 1;
    if (this.#turn === 1) {
      yield { type: 'tool_call_started', id: 'call-edit', name: 'local_edit_file' };
      yield {
        type: 'tool_call_completed',
        id: 'call-edit',
        name: 'local_edit_file',
        argumentsJson: JSON.stringify({
          path: 'note.txt',
          expectedSha256: this.expectedSha256,
          edits: [{ oldText: 'before', newText: 'after' }],
        }),
      };
      yield { type: 'turn_completed', stopReason: 'tool_call' };
      return;
    }
    yield { type: 'text_delta', delta: 'Local edit completed.' };
    yield { type: 'turn_completed', stopReason: 'stop' };
  }
}

class MemorySecrets {
  async set(): Promise<void> {}
  async get(): Promise<string | undefined> {
    return 'secret';
  }
  async delete(): Promise<boolean> {
    return true;
  }
}

function saveAvailableModel(
  repositories: CoreRepositories,
  id: string,
  overrides: Partial<{
    protocol: 'openai_responses' | 'openai_chat_completions' | 'anthropic_messages';
    modelId: string;
    contextWindowTokens: number;
    maxOutputTokens: number;
    compactThresholdPercent: number;
    declaredCapabilities: {
      responses: boolean;
      streaming: boolean;
      toolCalls: boolean;
    };
  }> = {},
): void {
  const protocol = overrides.protocol ?? 'openai_chat_completions';
  const provider = createProviderProfile({
    id,
    name: 'Test',
    protocol,
    baseUrl: 'https://example.test/v1',
    credentialRef: `provider:${id}`,
    extraHeaders: {},
    timeoutMs: 30_000,
  });
  const created = createModelConfiguration({
    id,
    name: 'Test Model',
    providerProfileId: id,
    modelId: overrides.modelId ?? 'model-1',
    declaredCapabilities: overrides.declaredCapabilities ?? {
      responses: protocol === 'openai_responses',
      streaming: true,
      toolCalls: true,
    },
    ...(overrides.contextWindowTokens === undefined
      ? {}
      : { contextWindowTokens: overrides.contextWindowTokens }),
    ...(overrides.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: overrides.maxOutputTokens }),
    ...(overrides.compactThresholdPercent === undefined
      ? {}
      : { compactThresholdPercent: overrides.compactThresholdPercent }),
  });
  const model = {
    ...created,
    enabled: true,
    isDefault: true,
    validation: {
      status: 'available' as const,
      checkedAt: new Date().toISOString(),
      capabilities: created.declaredCapabilities,
      attempt: 1,
    },
    revision: 1,
  };
  repositories.saveProviderProfile(provider);
  repositories.saveModelConfiguration(model);
}

function configLaunch(executable: string) {
  return {
    executable,
    args: [],
    cwd: 'C:/work',
    env: {},
    columns: 80,
    rows: 24,
  };
}

function completePlaintextPosixCommands(pty: FakePty, failedCommand?: string): string[] {
  const originalWrite = pty.write.bind(pty);
  const capturedScripts: string[] = [];
  let buffer = '';
  pty.write = (data: string): void => {
    originalWrite(data);
    buffer += data;
    const fingerprintMatch = /(__TA_DIALECT_[A-Za-z0-9-]+__):\$\{0\}:\$\{PSVersionTable\}/.exec(
      buffer,
    );
    if (fingerprintMatch !== null) {
      const marker = fingerprintMatch[1];
      buffer = '';
      queueMicrotask(() => {
        pty.emitData(`${marker}:/bin/bash:\r\n`);
      });
      return;
    }
    // Extract nonce from the plaintext POSIX wrapper.
    // The wrapper contains: printf '__TA_DONE_%s;%s__\n' 'NONCE-VALUE' "$__ta_exit"
    const nonceMatch = /printf '__TA_DONE_%s;%s__\\n' '([^']+)'/i.exec(buffer);
    if (nonceMatch !== null) {
      const nonce = nonceMatch[1];
      const osMarker = /(__TA_OS_[A-Za-z0-9-]+__)/.exec(buffer)?.[1];
      const failed = failedCommand !== undefined && buffer.includes(failedCommand);
      capturedScripts.push(buffer);
      buffer = '';
      // Emit TA_START marker to begin output capture, then the completion event
      queueMicrotask(() => {
        pty.emitData('TA_START');
        if (failed) pty.emitData(failedCommand + ': No such file or directory\r\n');
        if (osMarker !== undefined) pty.emitData(`${osMarker}:Linux\r\n`);
        pty.emitData('\u001b]777;TA;' + nonce + ';' + (failed ? '1' : '0') + '\u0007');
      });
    }
  };
  return capturedScripts;
}

async function waitForCommandDispatch(
  actor: Awaited<ReturnType<SessionManager['create']>>,
  pty: FakePty,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await Promise.resolve();
    await actor.idle();
    if (pty.writes.some((write) => write.includes('__TA_DONE_%s;%s__'))) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('command payload was not fully dispatched');
}

describe('AgentCoordinator', () => {
  it('provides terminal output from the bound Session journal without taking its lease', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const repositories = new CoreRepositories(store);
      const pty = new FakePty(1);
      const sessions = new SessionManager({ spawn: () => pty });
      const actor = await sessions.create({
        id: 'session-observe',
        executionDialect: 'powershell',
        launch: configLaunch('powershell.exe'),
      });
      await actor.verifyCurrentEnvironment('powershell', 'windows', 'windows');
      await actor.transitionShell('probing');
      await actor.transitionShell('ready');
      saveAvailableModel(repositories, 'provider-observe');
      const journal = new OutputJournal();
      journal.append('session-observe', Buffer.from('remote-host ready\n'));
      const adapter = new ObserveOutputAdapter();
      const coordinator = new AgentCoordinator({
        sessions,
        journal,
        repositories,
        providers: new ProviderProfileService(repositories),
        models: new ModelCatalogService(repositories),
        secrets: new MemorySecrets(),
        scheduler: new AgentTaskScheduler(),
        policy: new PolicyEngine({ parse: async () => ({ hasError: false, tree: 'program' }) }),
        createAdapter: () => adapter,
        emitTimeline: () => undefined,
      });

      try {
        await coordinator.start('session-observe', 'inspect current output');
        await coordinator.idle();

        expect(adapter.requests).toHaveLength(3);
        expect(adapter.requests[0]?.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining(
                'operatingSystem=windows; dialect=powershell; platform=windows',
              ),
            }),
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining('capabilityEpoch='),
            }),
          ]),
        );
        expect(adapter.requests[1]?.items.at(-1)).toMatchObject({
          type: 'tool_result',
          toolCallId: 'call-observe',
          content: expect.stringContaining('remote-host ready'),
        });
        expect(pty.writes).toEqual([]);
        expect(sessions.get('session-observe')?.snapshot.lease.owner).toEqual({ kind: 'user' });
      } finally {
        await coordinator.closeAll();
        await store.close();
      }
    });
  });

  it('completes a conversational turn without probing or acquiring the terminal lease', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const repositories = new CoreRepositories(store);
      const pty = new FakePty(1);
      const sessions = new SessionManager({ spawn: () => pty });
      const actor = await sessions.create({
        id: 'session-chat',
        executionDialect: 'powershell',
        launch: {
          executable: 'powershell.exe',
          args: ['-NoLogo'],
          cwd: 'C:/work',
          env: {},
          columns: 80,
          rows: 24,
        },
      });
      await actor.transitionShell('probing');
      await actor.transitionShell('ready');
      await actor.verifyCurrentEnvironment('powershell', 'windows', 'windows');
      saveAvailableModel(repositories, 'provider-chat', {
        contextWindowTokens: 8_192,
        maxOutputTokens: 512,
        compactThresholdPercent: 50,
      });
      const adapter = new ChatAdapter();
      const timeline: Array<{
        id: string;
        kind: string;
        text: string;
        status?: string | undefined;
        risk?: string | undefined;
        reasons?: readonly string[] | undefined;
      }> = [];
      const coordinator = new AgentCoordinator({
        sessions,
        repositories,
        providers: new ProviderProfileService(repositories),
        models: new ModelCatalogService(repositories),
        secrets: new MemorySecrets(),
        scheduler: new AgentTaskScheduler(),
        policy: new PolicyEngine({ parse: async () => ({ hasError: false, tree: 'program' }) }),
        createAdapter: () => adapter,
        emitTimeline: (item) => timeline.push(item),
      });

      try {
        const firstTurn = await coordinator.start('session-chat', '你能帮我做什么？', {
          modelConfigurationId: 'provider-chat',
          reasoningEffort: 'low',
          permissionMode: 'manual',
        });
        await coordinator.idle();

        expect(pty.writes).toEqual([]);
        expect(sessions.get('session-chat')?.snapshot.lease.owner).toEqual({ kind: 'user' });
        expect(repositories.listAgentConversations('session-chat')).toHaveLength(1);
        const conversation = repositories.listAgentConversations('session-chat')[0]!;
        expect(firstTurn).toMatchObject({
          conversationId: conversation.id,
          turnId: expect.any(String),
        });
        expect(conversation.permissionMode).toBe('manual');
        expect(repositories.listAgentTurns(conversation.id)).toHaveLength(1);
        expect(repositories.listAgentTurns(conversation.id)[0]).toMatchObject({
          modelConfigurationId: 'provider-chat',
          modelConfigurationRevision: 1,
          providerProfileId: 'provider-chat',
          providerProfileRevision: 0,
          modelId: 'model-1',
          reasoningEffort: 'low',
          permissionMode: 'manual',
        });
        expect(repositories.listModelItems(conversation.id)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'user_text', content: '你能帮我做什么？' }),
            expect.objectContaining({
              type: 'assistant_text',
              content: expect.stringContaining('对话'),
            }),
          ]),
        );
        const assistantItems = timeline.filter((item) => item.kind === 'assistant');
        expect(assistantItems.at(-1)).toMatchObject({
          text: '我可以和你对话，也可以按需调用终端或本机文件工具。',
          status: 'completed',
        });
        expect(new Set(assistantItems.map((item) => item.id)).size).toBe(1);

        await coordinator.start('session-chat', '继续');
        await coordinator.idle();
        expect(repositories.listAgentConversations('session-chat')).toHaveLength(1);
        expect(repositories.listAgentTurns(conversation.id)).toHaveLength(2);
        expect(adapter.requests[1]?.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining('你能帮我做什么'),
            }),
            expect.objectContaining({
              role: 'assistant',
              content: expect.stringContaining('对话'),
            }),
            expect.objectContaining({ role: 'user', content: expect.stringContaining('继续') }),
          ]),
        );
        expect(await coordinator.history('session-chat')).toMatchObject({
          sessionId: 'session-chat',
          conversation: { id: conversation.id, permissionMode: 'manual' },
          turns: expect.arrayContaining([expect.objectContaining({ userMessage: '继续' })]),
          items: expect.arrayContaining([
            expect.objectContaining({
              type: 'assistant_text',
              content: expect.stringContaining('对话'),
            }),
          ]),
        });

        await coordinator.start('session-chat', '很长的历史信息'.repeat(650));
        await coordinator.idle();
        await coordinator.start('session-chat', '压缩后继续');
        await coordinator.idle();
        const compactions = repositories.listConversationCompactions(conversation.id);
        expect(compactions).toHaveLength(1);
        expect(compactions[0]).toMatchObject({
          throughSequence: expect.any(Number),
          summary: expect.stringContaining('很长的历史信息'),
        });
        expect(adapter.requests[3]?.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: 'system',
              content: expect.stringContaining('对话摘要'),
            }),
          ]),
        );

        await coordinator.resetConversation('session-chat', conversation.id);
        expect(repositories.getAgentConversation(conversation.id)?.status).toBe('reset');
        expect(timeline.at(-1)).toMatchObject({
          kind: 'system',
          status: 'completed',
          text: '对话已重置',
        });

        await coordinator.start('session-chat', '这是新对话');
        await coordinator.idle();
        const conversations = repositories.listAgentConversations('session-chat');
        expect(conversations).toHaveLength(2);
        const activeConversation = conversations.find((item) => item.status === 'active');
        expect(activeConversation?.id).not.toBe(conversation.id);
        expect(adapter.requests[4]?.items).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: expect.stringContaining('继续') }),
          ]),
        );
      } finally {
        await coordinator.closeAll();
        await store.close();
      }
    });
  });

  it('interrupts an active terminal transaction when an Agent turn is cancelled', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const repositories = new CoreRepositories(store);
      const pty = new FakePty(1);
      const sessions = new SessionManager({ spawn: () => pty });
      const actor = await sessions.create({
        id: 'session-cancel-active-command',
        executionDialect: 'posix',
        launch: configLaunch('bash.exe'),
      });
      await actor.transitionShell('probing');
      await actor.transitionShell('ready');
      await actor.verifyCurrentEnvironment('posix', 'unix', 'linux');
      saveAvailableModel(repositories, 'provider-cancel-active-command');
      const timeline: AgentTimelineItem[] = [];
      const coordinator = new AgentCoordinator({
        sessions,
        repositories,
        providers: new ProviderProfileService(repositories),
        models: new ModelCatalogService(repositories),
        secrets: new MemorySecrets(),
        scheduler: new AgentTaskScheduler(),
        policy: new PolicyEngine({ parse: async () => ({ hasError: false, tree: 'program' }) }),
        createAdapter: () => new ScriptedAdapter(),
        emitTimeline: (item) => timeline.push(item),
      });

      try {
        const started = await coordinator.start(
          'session-cancel-active-command',
          'run a command that needs cancellation',
          { modelConfigurationId: 'provider-cancel-active-command' },
        );
        await waitForCommandDispatch(actor, pty);
        await coordinator.cancel('session-cancel-active-command', started.turnId);
        await coordinator.idle();

        expect(pty.interruptCount).toBe(1);
        expect(coordinator.hasActiveTask('session-cancel-active-command')).toBe(false);
        expect(repositories.getAgentTurn(started.turnId)?.status).toBe('cancelled');
        expect(timeline).toContainEqual(
          expect.objectContaining({ kind: 'command', status: 'interrupted' }),
        );
      } finally {
        await coordinator.closeAll();
        await store.close();
      }
    });
  });

  it('cancels a turn while it is waiting for approval and closes the pending approval', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const repositories = new CoreRepositories(store);
      const pty = new FakePty(1);
      const sessions = new SessionManager({ spawn: () => pty });
      const actor = await sessions.create({
        id: 'session-cancel-approval',
        executionDialect: 'posix',
        launch: configLaunch('bash.exe'),
      });
      await actor.transitionShell('probing');
      await actor.transitionShell('ready');
      await actor.verifyCurrentEnvironment('posix', 'unix', 'linux');
      saveAvailableModel(repositories, 'provider-cancel-approval');
      const adapter = new ApprovalAdapter();
      const timeline: AgentTimelineItem[] = [];
      const coordinator = new AgentCoordinator({
        sessions,
        repositories,
        providers: new ProviderProfileService(repositories),
        models: new ModelCatalogService(repositories),
        secrets: new MemorySecrets(),
        scheduler: new AgentTaskScheduler(),
        policy: new PolicyEngine({ parse: async () => ({ hasError: false, tree: 'program' }) }),
        createAdapter: () => adapter,
        emitTimeline: (item) => timeline.push(item),
      });

      try {
        const started = await coordinator.start('session-cancel-approval', 'cancel approval', {
          modelConfigurationId: 'provider-cancel-approval',
          permissionMode: 'manual',
        });
        await coordinator.idle();
        const approval = timeline.find((item) => item.kind === 'approval');
        expect(approval).toMatchObject({ status: 'waiting_approval' });

        await coordinator.cancel('session-cancel-approval', started.turnId);
        await coordinator.idle();

        expect(coordinator.hasActiveTask('session-cancel-approval')).toBe(false);
        expect(repositories.getAgentTask(started.taskId)?.status).toBe('cancelled');
        expect(
          timeline.filter((item) => item.id === approval?.id).map((item) => item.status),
        ).toEqual(['waiting_approval', 'cancelled']);
      } finally {
        await coordinator.closeAll();
        await store.close();
      }
    });
  });

  it('rejects a pending approval when the user takes over the terminal', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const repositories = new CoreRepositories(store);
      const pty = new FakePty(1);
      const sessions = new SessionManager({ spawn: () => pty });
      const actor = await sessions.create({
        id: 'session-takeover-approval',
        executionDialect: 'posix',
        launch: configLaunch('bash.exe'),
      });
      await actor.transitionShell('probing');
      await actor.transitionShell('ready');
      await actor.verifyCurrentEnvironment('posix', 'unix', 'linux');
      saveAvailableModel(repositories, 'provider-takeover-approval');
      const adapter = new ApprovalAdapter();
      const timeline: AgentTimelineItem[] = [];
      const auditRecords: Array<{ type: string }> = [];
      const coordinator = new AgentCoordinator({
        sessions,
        repositories,
        providers: new ProviderProfileService(repositories),
        models: new ModelCatalogService(repositories),
        secrets: new MemorySecrets(),
        scheduler: new AgentTaskScheduler(),
        policy: new PolicyEngine({ parse: async () => ({ hasError: false, tree: 'program' }) }),
        createAdapter: () => adapter,
        emitTimeline: (item) => timeline.push(item),
        audit: {
          record: (input: { type: string }) => auditRecords.push(input),
          recordCommand: () => undefined,
        },
      });

      try {
        const started = await coordinator.start('session-takeover-approval', 'reject approval', {
          modelConfigurationId: 'provider-takeover-approval',
          permissionMode: 'manual',
        });
        await coordinator.idle();
        const approval = timeline.find((item) => item.kind === 'approval');
        expect(approval).toMatchObject({ status: 'waiting_approval' });

        await coordinator.takeover('session-takeover-approval');
        await coordinator.idle();

        expect(coordinator.hasActiveTask('session-takeover-approval')).toBe(false);
        expect(repositories.getAgentTask(started.taskId)?.status).toBe('cancelled');
        expect(repositories.getAgentTurn(started.turnId)?.status).toBe('cancelled');
        expect(
          timeline.filter((item) => item.id === approval?.id).map((item) => item.status),
        ).toEqual(['waiting_approval', 'cancelled']);
        expect(adapter.requests).toHaveLength(1);
        expect(auditRecords.map((record) => record.type)).toEqual(
          expect.arrayContaining(['approval.rejected', 'session.takeover', 'task.cancelled']),
        );
      } finally {
        await coordinator.closeAll();
        await store.close();
      }
    });
  });

  it('cancels a turn while the current PTY environment probe is pending', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const repositories = new CoreRepositories(store);
      const pty = new FakePty(1);
      const sessions = new SessionManager({ spawn: () => pty });
      await sessions.create({
        id: 'session-cancel-probe',
        executionDialect: 'posix',
        launch: configLaunch('bash.exe'),
      });
      saveAvailableModel(repositories, 'provider-cancel-probe');
      const adapter = new ChatAdapter();
      const coordinator = new AgentCoordinator({
        sessions,
        repositories,
        providers: new ProviderProfileService(repositories),
        models: new ModelCatalogService(repositories),
        secrets: new MemorySecrets(),
        scheduler: new AgentTaskScheduler(),
        policy: new PolicyEngine({ parse: async () => ({ hasError: false, tree: 'program' }) }),
        createAdapter: () => adapter,
        emitTimeline: () => undefined,
      });

      try {
        const started = await coordinator.start('session-cancel-probe', 'cancel probe', {
          modelConfigurationId: 'provider-cancel-probe',
        });
        for (let attempt = 0; attempt < 50; attempt += 1) {
          await Promise.resolve();
          await sessions.get('session-cancel-probe')?.idle();
          if (pty.writes.some((write) => write.includes('__TA_DIALECT_'))) break;
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        expect(pty.writes.some((write) => write.includes('__TA_DIALECT_'))).toBe(true);

        await coordinator.cancel('session-cancel-probe', started.turnId);
        await coordinator.idle();

        expect(coordinator.hasActiveTask('session-cancel-probe')).toBe(false);
        expect(repositories.getAgentTask(started.taskId)?.status).toBe('cancelled');
        expect(adapter.requests).toHaveLength(0);
      } finally {
        await coordinator.closeAll();
        await store.close();
      }
    });
  });

  it('emits and audits a visible system error when the Provider turn fails', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const repositories = new CoreRepositories(store);
      const sessions = new SessionManager({ spawn: () => new FakePty(1) });
      await sessions.create({ id: 'session-failure', launch: configLaunch('powershell.exe') });
      saveAvailableModel(repositories, 'provider-failure');
      const timeline: Array<{
        kind: string;
        text: string;
        status?: string | undefined;
        toolCallId?: string | undefined;
        conversationId?: string | undefined;
        turnId?: string | undefined;
      }> = [];
      const audits: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const coordinator = new AgentCoordinator({
        sessions,
        repositories,
        providers: new ProviderProfileService(repositories),
        models: new ModelCatalogService(repositories),
        secrets: new MemorySecrets(),
        scheduler: new AgentTaskScheduler(),
        policy: new PolicyEngine({ parse: async () => ({ hasError: false, tree: 'program' }) }),
        createAdapter: () => new FailingAdapter(),
        emitTimeline: (item) => timeline.push(item),
        audit: {
          record: (event) => audits.push({ type: event.type, payload: event.payload }),
          recordCommand: () => undefined,
        },
      });

      try {
        const started = await coordinator.start('session-failure', '你好');
        await coordinator.idle();
        expect(timeline).toContainEqual(
          expect.objectContaining({
            kind: 'system',
            status: 'failed',
            text: expect.stringContaining('provider is unreachable'),
            conversationId: started.conversationId,
            turnId: started.turnId,
          }),
        );
        expect(audits).toContainEqual(
          expect.objectContaining({
            type: 'task.failed',
            payload: expect.objectContaining({
              error: expect.stringContaining('provider is unreachable'),
            }),
          }),
        );
      } finally {
        await coordinator.closeAll();
        await store.close();
      }
    });
  });

  it('resumes an approved sensitive local file call without acquiring the terminal lease', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const home = join(directory, 'home');
      await mkdir(join(home, '.ssh'), { recursive: true });
      await writeFile(
        join(home, '.ssh', 'id_ed25519'),
        '-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----',
      );
      const repositories = new CoreRepositories(store);
      const pty = new FakePty(1);
      const sessions = new SessionManager({ spawn: () => pty });
      const actor = await sessions.create({
        id: 'session-local-file',
        executionDialect: 'powershell',
        launch: configLaunch('powershell.exe'),
      });
      await actor.transitionShell('probing');
      await actor.transitionShell('ready');
      await actor.verifyCurrentEnvironment('powershell', 'windows', 'windows');
      saveAvailableModel(repositories, 'provider-local-file');
      const adapter = new SensitiveLocalFileAdapter();
      const timeline: Array<{
        id: string;
        kind: string;
        text: string;
        status?: string | undefined;
      }> = [];
      const coordinator = new AgentCoordinator({
        sessions,
        repositories,
        providers: new ProviderProfileService(repositories),
        models: new ModelCatalogService(repositories),
        secrets: new MemorySecrets(),
        scheduler: new AgentTaskScheduler(),
        policy: new PolicyEngine({ parse: async () => ({ hasError: false, tree: 'program' }) }),
        localFiles: await LocalFileService.create({ root: home }),
        localFilePolicy: new LocalFilePolicy(),
        createAdapter: () => adapter,
        emitTimeline: (item) => timeline.push(item),
      });

      try {
        const started = await coordinator.start('session-local-file', '检查本机 SSH 私钥');
        await coordinator.idle();
        const approval = timeline.find((item) => item.kind === 'approval');
        expect(approval).toMatchObject({ status: 'waiting_approval' });
        expect(pty.writes).toEqual([]);
        expect(sessions.get('session-local-file')?.snapshot.lease.owner).toEqual({ kind: 'user' });

        await coordinator.approve('session-local-file', approval!.id, false);
        await coordinator.idle();

        expect(adapter.requests).toHaveLength(3);
        expect(adapter.requests[1]?.items.at(-1)).toMatchObject({
          type: 'tool_result',
          toolCallId: 'call-sensitive',
          content: expect.stringContaining('[REDACTED]'),
        });
        expect(repositories.getAgentTask(started.taskId)?.status).toBe('completed');
        expect(pty.writes).toEqual([]);
      } finally {
        await coordinator.closeAll();
        await store.close();
      }
    });
  });

  it('carries a local file diff through scoped approval and structured audit', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const home = join(directory, 'home');
      await mkdir(home);
      await writeFile(join(home, 'note.txt'), 'before\n');
      const localFiles = await LocalFileService.create({ root: home });
      const current = await localFiles.read({ path: 'note.txt' });
      const repositories = new CoreRepositories(store);
      const pty = new FakePty(1);
      const sessions = new SessionManager({ spawn: () => pty });
      const actor = await sessions.create({
        id: 'session-local-edit',
        executionDialect: 'powershell',
        launch: configLaunch('powershell.exe'),
      });
      await actor.transitionShell('probing');
      await actor.transitionShell('ready');
      await actor.verifyCurrentEnvironment('powershell', 'windows', 'windows');
      saveAvailableModel(repositories, 'provider-local-edit');
      const adapter = new LocalEditApprovalAdapter(current.sha256);
      const timeline: AgentTimelineItem[] = [];
      const audits: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const coordinator = new AgentCoordinator({
        sessions,
        repositories,
        providers: new ProviderProfileService(repositories),
        models: new ModelCatalogService(repositories),
        secrets: new MemorySecrets(),
        scheduler: new AgentTaskScheduler(),
        policy: new PolicyEngine({ parse: async () => ({ hasError: false, tree: 'program' }) }),
        localFiles,
        localFilePolicy: new LocalFilePolicy(),
        createAdapter: () => adapter,
        emitTimeline: (item) => timeline.push(item),
        audit: {
          record: (input) => audits.push({ type: input.type, payload: input.payload }),
          recordCommand: () => undefined,
        },
      });

      try {
        await coordinator.start('session-local-edit', 'edit the local note', {
          permissionMode: 'manual',
        });
        await coordinator.idle();
        const approval = timeline.find((item) => item.kind === 'approval');
        expect(approval).toMatchObject({
          change: { path: 'note.txt', diff: expect.stringContaining('-before') },
        });

        await coordinator.approve('session-local-edit', approval!.id, false);
        await coordinator.idle();

        expect(await readFile(join(home, 'note.txt'), 'utf8')).toBe('after\n');
        const grantId = audits.find((event) => event.type === 'approval.granted')?.payload.grantId;
        expect(typeof grantId).toBe('string');
        expect(repositories.getApprovalGrant(String(grantId))).toMatchObject({
          scope: { toolCallId: 'call-edit' },
        });
        expect(audits).toContainEqual(
          expect.objectContaining({
            type: 'file.edit.completed',
            payload: expect.objectContaining({ toolCallId: 'call-edit' }),
          }),
        );
      } finally {
        await coordinator.closeAll();
        await store.close();
      }
    });
  });

  it('runs a natural-language task through probe, terminal tool, and final answer', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const repositories = new CoreRepositories(store);
      const pty = new FakePty(1);
      const spawner = { spawn: () => pty };
      const sessions = new SessionManager(spawner);
      await sessions.create({
        id: 'session-1',
        executionDialect: 'posix',
        launch: {
          executable: 'bash.exe',
          args: ['-i'],
          cwd: 'C:/work',
          env: {},
          columns: 80,
          rows: 24,
        },
      });
      const decodedScripts = completePlaintextPosixCommands(pty);

      saveAvailableModel(repositories, 'provider-1', {
        protocol: 'openai_responses',
        declaredCapabilities: { responses: true, streaming: true, toolCalls: true },
      });

      const adapter = new ScriptedAdapter();
      const timeline: Array<{ kind: string; text: string; status?: string | undefined }> = [];
      const coordinator = new AgentCoordinator({
        sessions,
        repositories,
        providers: new ProviderProfileService(repositories),
        models: new ModelCatalogService(repositories),
        secrets: new MemorySecrets(),
        scheduler: new AgentTaskScheduler(),
        policy: new PolicyEngine({
          async parse() {
            return { hasError: false, tree: 'program' };
          },
        }),
        contextBuilder: new ContextBuilder(),
        createAdapter: () => adapter,
        emitTimeline: (item) => timeline.push(item),
      });

      const started = await coordinator.start('session-1', 'run a harmless command');
      expect(started.taskId).toEqual(expect.any(String));
      await coordinator.idle();
      expect(timeline).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'user', text: 'run a harmless command' }),
          expect.objectContaining({
            kind: 'command',
            text: 'printf ok',
            status: 'completed',
            toolCallId: 'call-1',
          }),
          expect.objectContaining({ kind: 'assistant', text: 'Command completed.' }),
        ]),
      );
      expect(adapter.requests[0]?.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('operatingSystem=linux; dialect=posix; platform=unix'),
          }),
        ]),
      );
      expect(
        timeline
          .filter((item) => item.kind === 'command' && item.text === 'printf ok')
          .map((item) => item.status),
      ).toEqual(['running', 'completed', 'completed']);
      expect(decodedScripts.some((script) => script.includes('printf ok'))).toBe(true);
      expect(repositories.getAgentTask(started.taskId)?.status).toBe('completed');
      const conversation = repositories.listAgentConversations('session-1')[0]!;
      const turn = repositories.listAgentTurns(conversation.id)[0]!;
      expect(repositories.listToolCalls(turn.id)).toEqual([
        expect.objectContaining({ id: 'call-1', name: 'terminal_execute', status: 'completed' }),
      ]);
      expect(repositories.listModelItems(conversation.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'assistant_tool_call',
            toolCallId: 'call-1',
            name: 'terminal_execute',
          }),
          expect.objectContaining({ type: 'tool_result', toolCallId: 'call-1', isError: false }),
        ]),
      );
      await store.close();
    });
  });

  it('marks a non-zero command as failed while returning the result to the model', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const repositories = new CoreRepositories(store);
      const pty = new FakePty(1);
      const sessions = new SessionManager({ spawn: () => pty });
      await sessions.create({
        id: 'session-command-failure',
        executionDialect: 'posix',
        launch: {
          executable: 'bash.exe',
          args: ['-i'],
          cwd: 'C:/work',
          env: {},
          columns: 80,
          rows: 24,
        },
      });
      const failedCommand = 'cat /definitely/missing/path';
      completePlaintextPosixCommands(pty, failedCommand);
      saveAvailableModel(repositories, 'provider-command-failure', {
        protocol: 'openai_responses',
        declaredCapabilities: { responses: true, streaming: true, toolCalls: true },
      });

      const adapter = new ScriptedAdapter(failedCommand);
      const timeline: AgentTimelineItem[] = [];
      const coordinator = new AgentCoordinator({
        sessions,
        repositories,
        providers: new ProviderProfileService(repositories),
        models: new ModelCatalogService(repositories),
        secrets: new MemorySecrets(),
        scheduler: new AgentTaskScheduler(),
        policy: new PolicyEngine({
          async parse() {
            return { hasError: false, tree: 'program' };
          },
        }),
        contextBuilder: new ContextBuilder(),
        createAdapter: () => adapter,
        emitTimeline: (item) => timeline.push(item),
      });

      try {
        const started = await coordinator.start('session-command-failure', 'inspect memory');
        await coordinator.idle();

        expect(timeline).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'command',
              text: failedCommand,
              status: 'failed',
            }),
            expect.objectContaining({
              kind: 'tool',
              toolRole: 'result',
              status: 'failed',
              text: expect.stringContaining('command_failed'),
            }),
          ]),
        );
        expect(
          timeline
            .filter((item) => item.kind === 'command' && item.text === failedCommand)
            .map((item) => item.status),
        ).toEqual(['running', 'failed', 'failed']);
        expect(adapter.requests[1]?.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'tool_result',
              toolCallId: 'call-1',
              isError: true,
              content: expect.stringContaining('command_failed'),
            }),
          ]),
        );
        const conversation = repositories.listAgentConversations('session-command-failure')[0]!;
        const turn = repositories.listAgentTurns(conversation.id)[0]!;
        expect(repositories.listToolCalls(turn.id)).toEqual([
          expect.objectContaining({
            id: 'call-1',
            status: 'recoverable_error',
          }),
        ]);
        expect(repositories.getAgentTask(started.taskId)?.status).toBe('completed');
      } finally {
        await coordinator.closeAll();
        await store.close();
      }
    });
  });

  it('keeps post-tool candidates out of the Timeline and persisted conversation', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const repositories = new CoreRepositories(store);
      const pty = new FakePty(1);
      const sessions = new SessionManager({ spawn: () => pty });
      await sessions.create({
        id: 'session-completion-review',
        executionDialect: 'posix',
        launch: {
          executable: 'bash.exe',
          args: ['-i'],
          cwd: 'C:/work',
          env: {},
          columns: 80,
          rows: 24,
        },
      });
      const decodedScripts = completePlaintextPosixCommands(pty);
      saveAvailableModel(repositories, 'provider-completion-review', {
        protocol: 'openai_responses',
        declaredCapabilities: { responses: true, streaming: true, toolCalls: true },
      });
      const adapter = new PartialCompletionAdapter();
      const timeline: AgentTimelineItem[] = [];
      const coordinator = new AgentCoordinator({
        sessions,
        repositories,
        providers: new ProviderProfileService(repositories),
        models: new ModelCatalogService(repositories),
        secrets: new MemorySecrets(),
        scheduler: new AgentTaskScheduler(),
        policy: new PolicyEngine({
          async parse() {
            return { hasError: false, tree: 'program' };
          },
        }),
        contextBuilder: new ContextBuilder(),
        createAdapter: () => adapter,
        emitTimeline: (item) => timeline.push(item),
      });

      try {
        await coordinator.start('session-completion-review', '依次完成两个检查');
        await coordinator.idle();

        expect(adapter.requests).toHaveLength(5);
        expect(decodedScripts.some((script) => script.includes('printf first'))).toBe(true);
        expect(decodedScripts.some((script) => script.includes('printf second'))).toBe(true);
        expect(timeline.some((item) => item.text === '所有检查均已完成。')).toBe(false);
        expect(timeline.some((item) => item.text === '补充检查后完成。')).toBe(false);
        expect(
          timeline.some((item) => item.text === '开始执行检查。已验证两个检查项均完成。'),
        ).toBe(false);
        expect(timeline).toContainEqual(
          expect.objectContaining({
            kind: 'assistant',
            text: '已验证两个检查项均完成。',
            status: 'completed',
          }),
        );
        const conversation = repositories.listAgentConversations('session-completion-review')[0]!;
        expect(
          repositories
            .listModelItems(conversation.id)
            .flatMap((item) => (item.type === 'assistant_text' ? [item.content] : [])),
        ).toEqual(['开始执行检查。', '已验证两个检查项均完成。']);
      } finally {
        await coordinator.closeAll();
        await store.close();
      }
    });
  });

  it('resumes the exact pending tool call after approval before continuing the model turn', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const repositories = new CoreRepositories(store);
      const pty = new FakePty(1);
      const sessions = new SessionManager({ spawn: () => pty });
      await sessions.create({
        id: 'session-approval',
        executionDialect: 'posix',
        launch: {
          executable: 'bash.exe',
          args: ['-i'],
          cwd: 'C:/work',
          env: {},
          columns: 80,
          rows: 24,
        },
      });
      const decodedScripts = completePlaintextPosixCommands(pty);
      saveAvailableModel(repositories, 'provider-approval', {
        protocol: 'openai_responses',
        declaredCapabilities: { responses: true, streaming: true, toolCalls: true },
      });
      const adapter = new ApprovalAdapter();
      const timeline: Array<{
        id: string;
        kind: string;
        text: string;
        status?: string | undefined;
      }> = [];
      const auditRecords: Array<{ type: string }> = [];
      const commandAudits: Array<{ status: string; command: string }> = [];
      const coordinator = new AgentCoordinator({
        sessions,
        repositories,
        providers: new ProviderProfileService(repositories),
        models: new ModelCatalogService(repositories),
        secrets: new MemorySecrets(),
        scheduler: new AgentTaskScheduler(),
        policy: new PolicyEngine({
          async parse() {
            return { hasError: false, tree: 'program' };
          },
        }),
        contextBuilder: new ContextBuilder(),
        createAdapter: () => adapter,
        emitTimeline: (item) => timeline.push(item),
        audit: {
          record: (input: { type: string }) => auditRecords.push(input),
          recordCommand: (input: { status: string; command: string }) => commandAudits.push(input),
        },
      });

      try {
        const started = await coordinator.start('session-approval', 'create the approved marker', {
          modelConfigurationId: 'provider-approval',
          reasoningEffort: 'low',
          permissionMode: 'manual',
        });
        await coordinator.idle();
        const approval = timeline.find((item) => item.kind === 'approval');
        expect(coordinator.hasActiveTask('session-approval')).toBe(true);
        expect(coordinator.hasActiveTask('another-session')).toBe(false);
        expect(approval).toMatchObject({
          text: 'touch /tmp/approved',
          status: 'waiting_approval',
          risk: 'mutating',
          reasons: ['touch can change system state'],
        });
        expect(decodedScripts.some((script) => script.includes('touch /tmp/approved'))).toBe(false);

        await coordinator.approve('session-approval', approval!.id, false);
        await coordinator.idle();
        expect(coordinator.hasActiveTask('session-approval')).toBe(false);

        expect(
          timeline.filter((item) => item.id === approval!.id).map((item) => item.status),
        ).toEqual(['waiting_approval', 'completed']);

        expect(decodedScripts.some((script) => script.includes('touch /tmp/approved'))).toBe(true);
        expect(adapter.requests).toHaveLength(3);
        expect(adapter.requests[1]?.items.at(-1)).toMatchObject({
          type: 'tool_result',
          toolCallId: 'call-approval',
          content: expect.stringContaining('"status":"completed"'),
        });
        expect(repositories.getAgentTask(started.taskId)?.status).toBe('completed');
        expect(auditRecords.map((record) => record.type)).toEqual(
          expect.arrayContaining([
            'task.started',
            'approval.requested',
            'approval.granted',
            'task.completed',
          ]),
        );
        expect(commandAudits).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ status: 'completed', command: 'touch /tmp/approved' }),
          ]),
        );
      } finally {
        await coordinator.closeAll();
        await store.close();
      }
    });
  });
});
