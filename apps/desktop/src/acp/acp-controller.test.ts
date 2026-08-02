/**
 * ACP 控制器测试（specs/acp-driver、ADR-0028 ~ ADR-0031）
 *
 * 使用内存双工流假 Agent 走完整 ACP JSON-RPC 握手与 prompt 流程，
 * 覆盖：未开始任务不 spawn、多会话历史隔离、单一审批通道、
 * 未声明能力拒绝、进程崩溃终态映射、关闭即终止。
 */
import { PassThrough } from 'node:stream';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { AgentTimelineItem } from '@synapse-term/ui-platform';
import { withTemporaryDirectory } from '@synapse-term/test-kit';

import { createAcpControllerWithStore, type AcpAgentSpawner } from './acp-controller.js';
import { createAcpSettingsStore } from './acp-settings.js';

interface FakeAgentOptions {
  stopReason?: 'end_turn' | 'max_tokens' | 'cancelled' | 'refusal';
  /** prompt 收到后执行（可在这里发起 permission 请求），之后才回 stopReason */
  onPrompt?: (params: unknown, agent: FakeAcpAgent) => Promise<void> | void;
}

/** 内存双工假 ACP Agent：newline-delimited JSON-RPC，行为可编排 */
class FakeAcpAgent {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly exited: Promise<void>;
  killed = false;
  promptHandled: Promise<void> = Promise.resolve();

  readonly child = {
    stdin: this.stdin,
    stdout: this.stdout,
    stderr: this.stderr,
    once: (_event: string, listener: (...args: unknown[]) => void) => {
      this.#exitListeners.push(
        listener as (code: number | null, signal: NodeJS.Signals | null) => void,
      );
      return this.child;
    },
    kill: () => {
      this.killed = true;
      if (!this.#exitEmitted) {
        setImmediate(() => this.emitExit(0, null));
      }
      return true;
    },
  } as unknown as ReturnType<AcpAgentSpawner>['child'];

  #exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  #pendingResponses = new Map<string, (message: unknown) => void>();
  #readBuffer = '';
  #requestSequence = 0;
  #resolveExited!: () => void;
  #exitEmitted = false;

  constructor(private readonly options: FakeAgentOptions = {}) {
    this.exited = new Promise((resolve) => {
      this.#resolveExited = resolve;
    });
    this.stdin.on('data', (chunk: Buffer) => this.#onData(chunk));
  }

  #onData(chunk: Buffer): void {
    this.#readBuffer += chunk.toString('utf8');
    const lines = this.#readBuffer.split('\n');
    this.#readBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let message: unknown;
      try {
        message = JSON.parse(trimmed);
      } catch {
        continue;
      }
      void this.#handle(message);
    }
  }

  async #handle(message: unknown): Promise<void> {
    const record = message as {
      id?: string | number;
      method?: string;
      params?: unknown;
      result?: unknown;
    };
    if (record.id !== undefined && record.method !== undefined) {
      switch (record.method) {
        case 'initialize':
          this.#respond(record.id, { protocolVersion: 1 });
          return;
        case 'session/new':
          this.#respond(record.id, { sessionId: 'fake-acp-session' });
          return;
        case 'session/prompt':
          await this.#handlePrompt(record.id, record.params);
          return;
        case 'session/cancel':
          this.#respond(record.id, {});
          return;
        default:
          this.#respondError(record.id, `unknown method: ${record.method}`);
          return;
      }
    }
    if (record.id !== undefined) {
      const resolve = this.#pendingResponses.get(String(record.id));
      if (resolve !== undefined) {
        this.#pendingResponses.delete(String(record.id));
        resolve(record);
      }
    }
  }

  async #handlePrompt(id: string | number, params: unknown): Promise<void> {
    this.promptHandled = (async () => {
      if (this.options.onPrompt !== undefined) {
        await this.options.onPrompt(params, this);
      }
    })();
    await this.promptHandled;
    if (this.#exitEmitted) return;
    this.#respond(id, { stopReason: this.options.stopReason ?? 'end_turn' });
  }

  /** 主动向客户端发起请求（如 session/request_permission），返回客户端响应 */
  sendRequest(method: string, params: unknown): Promise<unknown> {
    const id = `fake-req-${(this.#requestSequence += 1)}`;
    return new Promise((resolve) => {
      this.#pendingResponses.set(id, resolve);
      this.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#exitEmitted) return;
    this.#exitEmitted = true;
    this.#resolveExited();
    const listeners = [...this.#exitListeners];
    this.#exitListeners = [];
    for (const listener of listeners) listener(code, signal);
  }

  #respond(id: string | number, result: unknown): void {
    if (this.#exitEmitted) return;
    this.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
  }

  #respondError(id: string | number, message: string): void {
    if (this.#exitEmitted) return;
    this.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message } })}\n`,
    );
  }
}

function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('waitFor 超时'));
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

interface Harness {
  controller: ReturnType<typeof createAcpControllerWithStore>;
  agents: FakeAcpAgent[];
  timeline: AgentTimelineItem[];
  request: ReturnType<typeof vi.fn>;
  spawner: ReturnType<typeof vi.fn>;
  nextAgent: () => FakeAcpAgent;
}

function createHarness(
  settingsDirectory: string,
  options: {
    classify?: (command: string) => 'allow_once' | 'approval_required';
    agentOptions?: FakeAgentOptions;
  } = {},
): Harness {
  const agents: FakeAcpAgent[] = [];
  const timeline: AgentTimelineItem[] = [];
  const request = vi.fn(async (method: string, payload: unknown) => {
    switch (method) {
      case 'external.classifyCommand': {
        const command = (payload as { command: string }).command;
        const authorization =
          options.classify?.(command) ??
          (command.includes('safe') ? 'allow_once' : 'approval_required');
        return {
          risk: 'mutating',
          requiresApproval: authorization === 'approval_required',
          authorization,
        };
      }
      case 'external.recordRejection':
        return { ok: true };
      case 'external.terminalExecute':
        return {
          ok: true,
          result: { transaction: { id: 'tx-fake' }, status: 'running' },
        };
      case 'external.terminalObserve':
        return { ok: true, result: { output: '', truncated: false } };
      case 'external.localReadFile':
        return { ok: true, result: { content: 'fake content' } };
      default:
        return { ok: false, error: `unhandled request: ${method}` };
    }
  });
  const spawner = vi.fn(() => {
    const agent = new FakeAcpAgent(options.agentOptions);
    agents.push(agent);
    return { child: agent.child, exited: agent.exited };
  });
  const controller = createAcpControllerWithStore(createAcpSettingsStore(settingsDirectory), {
    settingsDirectory,
    request,
    spawnAgent: spawner as unknown as AcpAgentSpawner,
    onTimeline: (item) => timeline.push(item),
  });
  return {
    controller,
    agents,
    timeline,
    request,
    spawner,
    nextAgent: () => agents.at(-1)!,
  };
}

describe('AcpController', () => {
  it('does not spawn any subprocess until a turn is started', async () => {
    await withTemporaryDirectory(async (directory) => {
      const harness = createHarness(join(directory, 'acp'));
      await harness.controller.setEnabled(true);
      expect(harness.spawner).not.toHaveBeenCalled();
      await expect(harness.controller.status()).resolves.toMatchObject({
        enabled: true,
        running: false,
        activeTurn: false,
      });
      await harness.controller.dispose();
    });
  });

  it('keeps per-session conversation histories isolated', async () => {
    await withTemporaryDirectory(async (directory) => {
      const harness = createHarness(join(directory, 'acp'), {
        classify: () => 'allow_once',
        agentOptions: { stopReason: 'end_turn' },
      });
      await harness.controller.setEnabled(true);
      await harness.controller.startTurn('session-a', '任务 A');
      await harness.controller.startTurn('session-b', '任务 B');
      await waitFor(() => harness.agents.length === 2);

      const historyA = await harness.controller.history('session-a');
      const historyB = await harness.controller.history('session-b');
      expect(historyA.projection.userText).toEqual(['任务 A']);
      expect(historyB.projection.userText).toEqual(['任务 B']);
      expect(historyA.turns.some((turn) => turn.userMessage === '任务 B')).toBe(false);
      await harness.controller.dispose();
    });
  });

  it('routes approvals through a single channel and ignores duplicate decisions', async () => {
    await withTemporaryDirectory(async (directory) => {
      let permissionOutcome: unknown;
      const harness = createHarness(join(directory, 'acp'), {
        classify: () => 'approval_required',
        agentOptions: {
          onPrompt: async (_params, agent) => {
            const response = await agent.sendRequest('session/request_permission', {
              sessionId: 'fake-acp-session',
              options: [
                { kind: 'allow_once', name: '允许一次', optionId: 'allow-1' },
                { kind: 'reject_once', name: '拒绝', optionId: 'reject-1' },
              ],
              toolCall: {
                toolCallId: 'tool-1',
                title: 'createTerminal',
                rawInput: { command: 'ls -la' },
              },
            });
            permissionOutcome = (response as { result: unknown }).result;
            // 权限获批后，Agent 再发起终端创建请求（ACP 权限与执行分离）
            await agent.sendRequest('terminal/create', {
              sessionId: 'fake-acp-session',
              command: 'ls -la',
            });
          },
        },
      });
      await harness.controller.setEnabled(true);
      await harness.controller.startTurn('session-a', '帮我看看目录');
      await waitFor(() =>
        harness.timeline.some(
          (item) => item.kind === 'approval' && item.status === 'waiting_approval',
        ),
      );
      const approvalItem: AgentTimelineItem | undefined = harness.timeline.find(
        (item) => item.kind === 'approval' && item.status === 'waiting_approval',
      )!;
      // 同一审批 id 第一次批准后，重复响应是安全的 no-op
      await harness.controller.respondApproval(approvalItem.id, true);
      await harness.controller.respondApproval(approvalItem.id, true);
      await waitFor(() => permissionOutcome !== undefined);

      expect(permissionOutcome).toMatchObject({
        outcome: { outcome: 'selected', optionId: 'allow-1' },
      });
      expect(
        harness.request.mock.calls.filter(([method]) => method === 'external.classifyCommand'),
      ).toHaveLength(1);
      expect(
        harness.request.mock.calls.filter(([method]) => method === 'external.terminalExecute'),
      ).toHaveLength(1);
      await waitFor(() =>
        harness.timeline.some(
          (item) =>
            item.kind === 'approval' && item.id === approvalItem!.id && item.status === 'completed',
        ),
      );
      await harness.controller.dispose();
    });
  });

  it('rejects undeclared capabilities with an audit record and no approval card', async () => {
    await withTemporaryDirectory(async (directory) => {
      let permissionOutcome: unknown;
      const harness = createHarness(join(directory, 'acp'), {
        classify: () => 'allow_once',
        agentOptions: {
          onPrompt: async (_params, agent) => {
            const response = await agent.sendRequest('session/request_permission', {
              sessionId: 'fake-acp-session',
              options: [
                { kind: 'allow_once', name: '允许一次', optionId: 'allow-1' },
                { kind: 'reject_once', name: '拒绝', optionId: 'reject-1' },
              ],
              toolCall: {
                toolCallId: 'tool-bash',
                title: 'bash',
                rawInput: { command: 'whoami' },
              },
            });
            permissionOutcome = (response as { result: unknown }).result;
          },
        },
      });
      await harness.controller.setEnabled(true);
      await harness.controller.startTurn('session-a', '执行原生命令');
      await waitFor(() => permissionOutcome !== undefined);

      expect(permissionOutcome).toMatchObject({
        outcome: { outcome: 'selected', optionId: 'reject-1' },
      });
      expect(
        harness.timeline.some(
          (item) => item.kind === 'approval' && item.status === 'waiting_approval',
        ),
      ).toBe(false);
      expect(harness.request).toHaveBeenCalledWith(
        'external.recordRejection',
        expect.objectContaining({ toolName: 'bash', reason: 'undeclared_capability' }),
      );
      await harness.controller.dispose();
    });
  });

  it('maps a crash mid-turn to failed and cancels pending approval cards', async () => {
    await withTemporaryDirectory(async (directory) => {
      const harness = createHarness(join(directory, 'acp'), {
        classify: () => 'approval_required',
        agentOptions: {
          // prompt 挂起：等待外部编排（先发审批请求，再崩溃）
          onPrompt: async (_params, agent) => {
            await agent.sendRequest('session/request_permission', {
              sessionId: 'fake-acp-session',
              options: [
                { kind: 'allow_once', name: '允许一次', optionId: 'allow-1' },
                { kind: 'reject_once', name: '拒绝', optionId: 'reject-1' },
              ],
              toolCall: {
                toolCallId: 'tool-1',
                title: 'createTerminal',
                rawInput: { command: 'rm -rf /tmp/x' },
              },
            });
          },
        },
      });
      await harness.controller.setEnabled(true);
      await harness.controller.startTurn('session-a', '危险命令');
      await waitFor(() =>
        harness.timeline.some(
          (item) => item.kind === 'approval' && item.status === 'waiting_approval',
        ),
      );
      const approvalId = harness.timeline.find(
        (item) => item.kind === 'approval' && item.status === 'waiting_approval',
      )!.id;

      harness.nextAgent().emitExit(null, 'SIGKILL');
      await waitFor(() =>
        harness.timeline.some((item) => item.kind === 'system' && item.status === 'failed'),
      );
      await expect(harness.controller.status()).resolves.toMatchObject({
        running: false,
        activeTurn: false,
      });
      expect(
        harness.timeline.some(
          (item) =>
            item.kind === 'approval' && item.id === approvalId && item.status === 'cancelled',
        ),
      ).toBe(true);
      const history = await harness.controller.history('session-a');
      expect(history.turns[0]?.status).toBe('failed');
      await harness.controller.dispose();
    });
  });

  it('terminates the subprocess when the conversation is closed', async () => {
    await withTemporaryDirectory(async (directory) => {
      const harness = createHarness(join(directory, 'acp'), {
        agentOptions: { stopReason: 'end_turn' },
      });
      await harness.controller.setEnabled(true);
      await harness.controller.startTurn('session-a', '任务');
      await waitFor(() => harness.agents.length === 1);
      expect(harness.nextAgent().killed).toBe(false);

      await harness.controller.closeConversation('session-a');
      expect(harness.nextAgent().killed).toBe(true);
      await expect(harness.controller.status()).resolves.toMatchObject({
        running: false,
        activeTurn: false,
      });
      await harness.controller.dispose();
    });
  });
});
