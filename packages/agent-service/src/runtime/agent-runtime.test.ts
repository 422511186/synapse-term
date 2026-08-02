import { describe, expect, it } from 'vitest';

import { createAgentTask } from '@synapse-term/domain';

import type { ModelAdapter, ModelEvent, ModelRequest } from '@synapse-term/model-providers';
import { AgentRuntime, type RuntimeToolGateway } from './agent-runtime.js';
import { AGENT_SYSTEM_PROMPT, ContextBuilder } from '../context/context-builder.js';
import { estimateModelItemsTokens } from '../context/token-estimator.js';

class ScriptedAdapter implements ModelAdapter {
  readonly requests: ModelRequest[] = [];
  #turns: ModelEvent[][];

  constructor(turns: readonly ModelEvent[][]) {
    this.#turns = turns.map((turn) => [...turn]);
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    const turn = this.#turns.shift();
    if (turn === undefined) throw new Error('no scripted turn');
    yield* turn;
  }
}

function task() {
  return createAgentTask({
    id: 'task-1',
    sessionId: 'session-1',
    providerProfileId: 'provider-1',
    goal: 'inspect disk',
  });
}

describe('AgentRuntime', () => {
  it('reviews a post-tool candidate and continues missing work before completing', async () => {
    const adapter = new ScriptedAdapter([
      [
        { type: 'text_delta', delta: '先检查主机。' },
        { type: 'tool_call_started', id: 'call-host', name: 'terminal_execute' },
        {
          type: 'tool_call_completed',
          id: 'call-host',
          name: 'terminal_execute',
          argumentsJson: '{"command":"uname -a"}',
        },
        { type: 'turn_completed', stopReason: 'tool_call' },
      ],
      [
        { type: 'text_delta', delta: '全部诊断已经完成。' },
        { type: 'turn_completed', stopReason: 'stop' },
      ],
      [
        { type: 'text_delta', delta: '发现缺少网络证据。' },
        { type: 'tool_call_started', id: 'call-network', name: 'terminal_execute' },
        {
          type: 'tool_call_completed',
          id: 'call-network',
          name: 'terminal_execute',
          argumentsJson: '{"command":"cat /proc/net/dev"}',
        },
        { type: 'turn_completed', stopReason: 'tool_call' },
      ],
      [
        { type: 'text_delta', delta: '补充网络证据后已完成。' },
        { type: 'turn_completed', stopReason: 'stop' },
      ],
      [
        { type: 'text_delta', delta: '已验证主机与网络诊断均完成。' },
        { type: 'turn_completed', stopReason: 'stop' },
      ],
    ]);
    const commands: string[] = [];
    const visibleEvents: Array<{ event: ModelEvent; replaceAssistantText?: boolean }> = [];
    const persistedItems: ModelRequest['items'][number][] = [];
    const runtime = new AgentRuntime({
      task: task(),
      model: 'model-1',
      adapter,
      gateway: {
        call: async (_name, argumentsValue) => {
          commands.push((argumentsValue as { command: string }).command);
          return { ok: true, result: { status: 'completed', exitCode: 0 } };
        },
      },
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: '检查主机和网络状态' },
      onModelEvent: (event, delivery) =>
        visibleEvents.push({
          event,
          ...(delivery?.replaceAssistantText === true ? { replaceAssistantText: true } : {}),
        }),
      onItem: (item) => persistedItems.push(item),
    });

    await expect(runtime.run()).resolves.toMatchObject({
      status: 'completed',
      answer: '已验证主机与网络诊断均完成。',
    });
    expect(commands).toEqual(['uname -a', 'cat /proc/net/dev']);
    expect(adapter.requests).toHaveLength(5);
    expect(
      adapter.requests[2]?.items.some(
        (item) => 'role' in item && item.role === 'user' && item.content.includes('完成性复核'),
      ),
    ).toBe(true);
    expect(adapter.requests[2]?.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', content: '全部诊断已经完成。' }),
      ]),
    );
    expect(adapter.requests[2]?.items.at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringMatching(/完整、自包含.*不得引用/s),
    });
    expect(
      visibleEvents
        .filter(({ event }) => event.type === 'text_delta')
        .map(({ event, replaceAssistantText }) => ({
          text: event.type === 'text_delta' ? event.delta : '',
          replaceAssistantText: replaceAssistantText === true,
        })),
    ).toEqual([
      { text: '先检查主机。', replaceAssistantText: false },
      { text: '发现缺少网络证据。', replaceAssistantText: false },
      { text: '已验证主机与网络诊断均完成。', replaceAssistantText: true },
    ]);
    expect(persistedItems.filter((item) => 'role' in item && item.role === 'assistant')).toEqual([
      { role: 'assistant', content: '先检查主机。' },
    ]);
  });

  it('fails closed when the completion review limit is exhausted', async () => {
    const toolTurn = (id: string, command: string): ModelEvent[] => [
      { type: 'tool_call_started', id, name: 'terminal_execute' },
      {
        type: 'tool_call_completed',
        id,
        name: 'terminal_execute',
        argumentsJson: JSON.stringify({ command }),
      },
      { type: 'turn_completed', stopReason: 'tool_call' },
    ];
    const textTurn = (text: string): ModelEvent[] => [
      { type: 'text_delta', delta: text },
      { type: 'turn_completed', stopReason: 'stop' },
    ];
    const adapter = new ScriptedAdapter([
      toolTurn('call-1', 'check-one'),
      textTurn('第一次候选答案'),
      toolTurn('call-2', 'check-two'),
      textTurn('第二次候选答案'),
      toolTurn('call-3', 'check-three'),
      textTurn('仍然无法确认'),
    ]);
    const visibleText: string[] = [];
    const runtime = new AgentRuntime({
      task: task(),
      model: 'model-1',
      adapter,
      gateway: {
        call: async (_name, argumentsValue) => ({
          ok: true,
          result: {
            status: 'completed',
            command: (argumentsValue as { command: string }).command,
          },
        }),
      },
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: '完成全部检查' },
      maxCompletionReviews: 2,
      onModelEvent: (event) => {
        if (event.type === 'text_delta') visibleText.push(event.delta);
      },
    });

    await expect(runtime.run()).resolves.toMatchObject({
      status: 'failed',
      answer: '',
      error: expect.stringContaining('maximum completion reviews exceeded'),
    });
    expect(adapter.requests).toHaveLength(6);
    expect(visibleText).toEqual([]);
  });

  it('preserves completion review state when a missing tool requires approval', async () => {
    const adapter = new ScriptedAdapter([
      [
        { type: 'tool_call_started', id: 'call-observe', name: 'terminal_observe' },
        {
          type: 'tool_call_completed',
          id: 'call-observe',
          name: 'terminal_observe',
          argumentsJson: '{}',
        },
        { type: 'turn_completed', stopReason: 'tool_call' },
      ],
      [
        { type: 'text_delta', delta: '检查已经完成。' },
        { type: 'turn_completed', stopReason: 'stop' },
      ],
      [
        { type: 'tool_call_started', id: 'call-review', name: 'terminal_execute' },
        {
          type: 'tool_call_completed',
          id: 'call-review',
          name: 'terminal_execute',
          argumentsJson: '{"command":"inspect-missing"}',
        },
        { type: 'turn_completed', stopReason: 'tool_call' },
      ],
      [
        { type: 'text_delta', delta: '补充检查已完成。' },
        { type: 'turn_completed', stopReason: 'stop' },
      ],
      [
        { type: 'text_delta', delta: '全部检查均有证据。' },
        { type: 'turn_completed', stopReason: 'stop' },
      ],
    ]);
    const callIds: string[] = [];
    let reviewAttempts = 0;
    const runtime = new AgentRuntime({
      task: task(),
      model: 'model-1',
      adapter,
      gateway: {
        call: async () => ({ ok: true, result: { status: 'completed' } }),
        callWithContext: async (name, _argumentsValue, context) => {
          callIds.push(context.toolCallId);
          if (name === 'terminal_execute') {
            reviewAttempts += 1;
            if (reviewAttempts === 1) {
              return { ok: true, result: { status: 'waiting_approval' } };
            }
          }
          return { ok: true, result: { status: 'completed' } };
        },
      },
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: '观察后补齐缺失检查' },
    });

    await expect(runtime.run()).resolves.toMatchObject({ status: 'waiting_approval' });
    await expect(runtime.resumeAfterApproval()).resolves.toMatchObject({
      status: 'completed',
      answer: '全部检查均有证据。',
    });
    expect(callIds).toEqual(['call-observe', 'call-review', 'call-review']);
    expect(adapter.requests).toHaveLength(5);
  });

  it('loops from a natural-language goal through ordered tool calls to a final answer', async () => {
    const adapter = new ScriptedAdapter([
      [
        { type: 'tool_call_started', id: 'call-1', name: 'terminal_execute' },
        { type: 'tool_call_delta', id: 'call-1', delta: '{"command":"df -h"}' },
        {
          type: 'tool_call_completed',
          id: 'call-1',
          name: 'terminal_execute',
          argumentsJson: '{"command":"df -h"}',
        },
        { type: 'turn_completed', stopReason: 'tool_call' },
      ],
      [
        { type: 'text_delta', delta: 'Disk is healthy.' },
        { type: 'turn_completed', stopReason: 'stop' },
      ],
      [
        { type: 'text_delta', delta: 'Disk is healthy.' },
        { type: 'turn_completed', stopReason: 'stop' },
      ],
    ]);
    const calls: string[] = [];
    const gateway: RuntimeToolGateway = {
      call: async (name, args) => {
        calls.push(`${name}:${JSON.stringify(args)}`);
        return { ok: true, result: { status: 'completed', output: '80% used' } };
      },
    };
    const runtime = new AgentRuntime({
      task: task(),
      model: 'model-1',
      adapter,
      gateway,
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: 'inspect disk' },
      maxOutputTokens: 4_096,
      reasoningEffort: 'high',
    });

    await expect(runtime.run()).resolves.toMatchObject({
      status: 'completed',
      answer: 'Disk is healthy.',
    });
    expect(calls).toEqual(['terminal_execute:{"command":"df -h"}']);
    expect(adapter.requests).toHaveLength(3);
    expect(adapter.requests[0]).toMatchObject({
      maxOutputTokens: 4_096,
      reasoningEffort: 'high',
    });
    expect(adapter.requests[0]?.tools?.map((tool) => tool.name)).toEqual([
      'terminal_observe',
      'terminal_execute',
      'terminal_wait',
      'terminal_interrupt',
      'local_list_files',
      'local_search_files',
      'local_read_file',
      'local_write_file',
      'local_edit_file',
    ]);
    expect(adapter.requests[0]?.items.some((item) => JSON.stringify(item).includes('$ '))).toBe(
      false,
    );
    expect(adapter.requests[1]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'assistant_tool_call',
          toolCallId: 'call-1',
          name: 'terminal_execute',
        }),
        expect.objectContaining({ type: 'tool_result', toolCallId: 'call-1' }),
      ]),
    );
  });

  it('accepts a task that is already running when resuming after an approval wait', async () => {
    const queued = task();
    const running = { ...queued, status: 'running' as const, revision: 1 };
    const runtime = new AgentRuntime({
      task: running,
      model: 'model-1',
      adapter: {
        async *stream() {
          yield { type: 'text_delta' as const, delta: 'resumed' };
          yield { type: 'turn_completed' as const, stopReason: 'stop' };
        },
      },
      gateway: { call: async () => ({ ok: true, result: {} }) },
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: 'resume' },
    });

    await expect(runtime.run()).resolves.toMatchObject({ status: 'completed' });
  });

  it('passes the Turn cancellation signal to an active local file tool', async () => {
    const adapter = new ScriptedAdapter([
      [
        { type: 'tool_call_started', id: 'call-search', name: 'local_search_files' },
        {
          type: 'tool_call_completed',
          id: 'call-search',
          name: 'local_search_files',
          argumentsJson: '{"query":"needle","mode":"content"}',
        },
        { type: 'turn_completed', stopReason: 'tool_call' },
      ],
    ]);
    let observedSignal: AbortSignal | undefined;
    let release!: () => void;
    let markStarted!: () => void;
    const toolStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const activeTool = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = new AgentRuntime({
      task: task(),
      model: 'model-1',
      adapter,
      gateway: {
        call: async () => ({ ok: true, result: {} }),
        callWithContext: async (_name, _argumentsValue, context) => {
          observedSignal = context.signal;
          markStarted();
          await activeTool;
          return { ok: false, error: 'cancelled', recoverable: true };
        },
      },
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: 'search local files' },
    });

    const result = runtime.run();
    await toolStarted;
    runtime.cancel();
    release();

    await expect(result).resolves.toMatchObject({ status: 'cancelled' });
    expect(observedSignal?.aborted).toBe(true);
  });

  it('reports streamed model events without changing task control flow', async () => {
    const events: ModelEvent[] = [];
    const adapter = new ScriptedAdapter([
      [
        { type: 'text_delta', delta: 'hello' },
        { type: 'turn_completed', stopReason: 'stop' },
      ],
    ]);
    const runtime = new AgentRuntime({
      task: task(),
      model: 'model-1',
      adapter,
      gateway: { call: async () => ({ ok: true, result: {} }) },
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: 'say hello' },
      onModelEvent: (event) => events.push(event),
    });

    await runtime.run();
    expect(events.map((event) => event.type)).toEqual(['text_delta', 'turn_completed']);
    expect(adapter.requests).toHaveLength(1);
  });

  it('executes multiple model tool calls sequentially in provider order', async () => {
    const adapter = new ScriptedAdapter([
      [
        { type: 'tool_call_started', id: 'call-1', name: 'terminal_observe' },
        {
          type: 'tool_call_completed',
          id: 'call-1',
          name: 'terminal_observe',
          argumentsJson: '{}',
        },
        { type: 'tool_call_started', id: 'call-2', name: 'terminal_execute' },
        {
          type: 'tool_call_completed',
          id: 'call-2',
          name: 'terminal_execute',
          argumentsJson: '{"command":"df -h"}',
        },
        { type: 'turn_completed', stopReason: 'tool_call' },
      ],
      [
        { type: 'text_delta', delta: 'done' },
        { type: 'turn_completed', stopReason: 'stop' },
      ],
      [
        { type: 'text_delta', delta: 'done' },
        { type: 'turn_completed', stopReason: 'stop' },
      ],
    ]);
    const order: string[] = [];
    const runtime = new AgentRuntime({
      task: task(),
      model: 'model-1',
      adapter,
      gateway: {
        call: async (name) => {
          order.push(name);
          return { ok: true, result: { status: 'completed' } };
        },
      },
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: 'inspect' },
    });

    await expect(runtime.run()).resolves.toMatchObject({ status: 'completed', answer: 'done' });
    expect(order).toEqual(['terminal_observe', 'terminal_execute']);
  });

  it('returns a result for every batched call after a terminal command remains running', async () => {
    const adapter = new ScriptedAdapter([
      [
        { type: 'tool_call_started', id: 'call-1', name: 'terminal_execute' },
        {
          type: 'tool_call_completed',
          id: 'call-1',
          name: 'terminal_execute',
          argumentsJson: '{"command":"df -P"}',
        },
        { type: 'tool_call_started', id: 'call-2', name: 'terminal_execute' },
        {
          type: 'tool_call_completed',
          id: 'call-2',
          name: 'terminal_execute',
          argumentsJson: '{"command":"cat /proc/loadavg"}',
        },
        { type: 'tool_call_started', id: 'call-3', name: 'terminal_execute' },
        {
          type: 'tool_call_completed',
          id: 'call-3',
          name: 'terminal_execute',
          argumentsJson: '{"command":"cat /proc/meminfo"}',
        },
        { type: 'turn_completed', stopReason: 'tool_call' },
      ],
      [
        { type: 'text_delta', delta: 'wait for the running command' },
        { type: 'turn_completed', stopReason: 'stop' },
      ],
      [
        { type: 'text_delta', delta: 'wait for the running command' },
        { type: 'turn_completed', stopReason: 'stop' },
      ],
    ]);
    let callIndex = 0;
    const runtime = new AgentRuntime({
      task: task(),
      model: 'model-1',
      adapter,
      gateway: {
        call: async () => {
          callIndex += 1;
          if (callIndex === 1) {
            return { ok: true, result: { status: 'running', transaction: { id: 'tx-1' } } };
          }
          return {
            ok: false,
            error: 'terminal_busy',
            message:
              'A terminal command is still running; call terminal_wait before executing another command',
            recoverable: true,
          };
        },
      },
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: 'inspect resources' },
    });

    await expect(runtime.run()).resolves.toMatchObject({ status: 'completed' });
    expect(callIndex).toBe(3);
    expect(adapter.requests[1]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tool_result', toolCallId: 'call-1', isError: false }),
        expect.objectContaining({ type: 'tool_result', toolCallId: 'call-2', isError: true }),
        expect.objectContaining({ type: 'tool_result', toolCallId: 'call-3', isError: true }),
      ]),
    );
  });

  it('stops on approval or user takeover and preserves the task status', async () => {
    const adapter = new ScriptedAdapter([
      [
        { type: 'tool_call_started', id: 'call-1', name: 'terminal_execute' },
        {
          type: 'tool_call_completed',
          id: 'call-1',
          name: 'terminal_execute',
          argumentsJson: '{"command":"rm -rf /"}',
        },
        { type: 'turn_completed', stopReason: 'tool_call' },
      ],
    ]);
    const runtime = new AgentRuntime({
      task: task(),
      model: 'model-1',
      adapter,
      gateway: {
        call: async () => ({ ok: true, result: { status: 'waiting_approval' } }),
      },
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: 'remove old files' },
    });

    await expect(runtime.run()).resolves.toMatchObject({ status: 'waiting_approval' });
  });

  it('cancels provider reasoning without interrupting a command gateway', async () => {
    let observedSignal: AbortSignal | undefined;
    const adapter: ModelAdapter = {
      stream(request, signal) {
        void request;
        observedSignal = signal;
        return {
          [Symbol.asyncIterator]() {
            return {
              next: async () => {
                await new Promise<void>((resolve) =>
                  signal?.addEventListener('abort', () => resolve(), { once: true }),
                );
                throw Object.assign(new Error('aborted'), { name: 'AbortError' });
              },
            };
          },
        };
      },
    };
    const runtime = new AgentRuntime({
      task: task(),
      model: 'model-1',
      adapter,
      gateway: { call: async () => ({ ok: true, result: { status: 'completed' } }) },
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: 'inspect' },
    });
    const result = runtime.run();
    runtime.cancel();

    await expect(result).resolves.toMatchObject({ status: 'cancelled' });
    expect(observedSignal?.aborted).toBe(true);
  });

  it('lets the current command finish before suspending after UI disconnect', async () => {
    const adapter = new ScriptedAdapter([
      [
        { type: 'tool_call_started', id: 'call-1', name: 'terminal_execute' },
        {
          type: 'tool_call_completed',
          id: 'call-1',
          name: 'terminal_execute',
          argumentsJson: '{"command":"sleep 1"}',
        },
        { type: 'turn_completed', stopReason: 'tool_call' },
      ],
    ]);
    let resolveCommand!: () => void;
    const commandCompleted = new Promise<void>((resolve) => {
      resolveCommand = resolve;
    });
    const runtime = new AgentRuntime({
      task: task(),
      model: 'model-1',
      adapter,
      gateway: {
        call: async () => {
          await commandCompleted;
          return { ok: true, result: { status: 'completed' } };
        },
      },
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: 'wait' },
    });

    const result = runtime.run();
    await Promise.resolve();
    runtime.disconnectUi();
    resolveCommand();
    await expect(result).resolves.toMatchObject({ status: 'suspended' });
  });

  it('enters waiting_user when a terminal tool requests takeover', async () => {
    const adapter = new ScriptedAdapter([
      [
        { type: 'tool_call_started', id: 'call-1', name: 'terminal_execute' },
        {
          type: 'tool_call_completed',
          id: 'call-1',
          name: 'terminal_execute',
          argumentsJson: '{"command":"sudo id"}',
        },
        { type: 'turn_completed', stopReason: 'tool_call' },
      ],
    ]);
    const runtime = new AgentRuntime({
      task: task(),
      model: 'model-1',
      adapter,
      gateway: { call: async () => ({ ok: true, result: { status: 'interaction_required' } }) },
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: 'inspect' },
    });

    await expect(runtime.run()).resolves.toMatchObject({ status: 'waiting_user' });
  });

  it('continues after a recoverable tool error and lets the model choose another action', async () => {
    const adapter = new ScriptedAdapter([
      [
        { type: 'tool_call_started', id: 'call-1', name: 'local_read_file' },
        {
          type: 'tool_call_completed',
          id: 'call-1',
          name: 'local_read_file',
          argumentsJson: '{"path":"missing.txt"}',
        },
        { type: 'turn_completed', stopReason: 'tool_call' },
      ],
      [
        { type: 'text_delta', delta: '文件不存在，请确认路径。' },
        { type: 'turn_completed', stopReason: 'stop' },
      ],
      [
        { type: 'text_delta', delta: '文件不存在，请确认路径。' },
        { type: 'turn_completed', stopReason: 'stop' },
      ],
    ]);
    const runtime = new AgentRuntime({
      task: task(),
      model: 'model-1',
      adapter,
      gateway: {
        call: async () => ({
          ok: false,
          error: 'local_file_not_found',
          message: 'missing.txt not found',
          recoverable: true,
        }),
      },
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: '读取文件' },
    });

    await expect(runtime.run()).resolves.toMatchObject({
      status: 'completed',
      answer: '文件不存在，请确认路径。',
    });
    expect(adapter.requests).toHaveLength(3);
    expect(adapter.requests[1]?.items.at(-1)).toMatchObject({
      type: 'tool_result',
      toolCallId: 'call-1',
      isError: true,
    });
  });

  it('returns a command audit rejection to the model instead of leaving the turn active', async () => {
    const adapter = new ScriptedAdapter([
      [
        { type: 'tool_call_started', id: 'call-command', name: 'terminal_execute' },
        {
          type: 'tool_call_completed',
          id: 'call-command',
          name: 'terminal_execute',
          argumentsJson: JSON.stringify({ command: 'free -h 2>/dev/null || wmic OS get Memory' }),
        },
        { type: 'turn_completed', stopReason: 'tool_call' },
      ],
      [
        { type: 'text_delta', delta: '当前命令无法审计，我会改用已验证的方式。' },
        { type: 'turn_completed', stopReason: 'stop' },
      ],
      [
        { type: 'text_delta', delta: '已收到命令错误。' },
        { type: 'turn_completed', stopReason: 'stop' },
      ],
    ]);
    let calls = 0;
    const runtime = new AgentRuntime({
      task: task(),
      model: 'model-1',
      adapter,
      gateway: {
        call: async () => {
          calls += 1;
          return {
            ok: false,
            error: 'command_not_auditable',
            message: 'compound command evaluated segment by segment',
            recoverable: true,
          };
        },
      },
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: 'inspect memory' },
    });

    await expect(runtime.run()).resolves.toMatchObject({
      status: 'completed',
      answer: '已收到命令错误。',
    });
    expect(calls).toBe(1);
    expect(adapter.requests).toHaveLength(3);
    expect(adapter.requests[1]?.items.at(-1)).toMatchObject({
      type: 'tool_result',
      toolCallId: 'call-command',
      isError: true,
    });
  });

  it('fails a model run that exceeds the configured active duration', async () => {
    const adapter: ModelAdapter = {
      async *stream(_request, signal) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(resolve, 80);
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timeout);
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            },
            { once: true },
          );
        });
        yield { type: 'text_delta', delta: 'too late' };
        yield { type: 'turn_completed', stopReason: 'stop' };
      },
    };
    const runtime = new AgentRuntime({
      task: task(),
      model: 'model-1',
      adapter,
      gateway: { call: async () => ({ ok: true, result: {} }) },
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: 'wait forever' },
      maxActiveDurationMs: 20,
    });

    await expect(runtime.run()).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('maximum active duration exceeded'),
    });
  });

  it('stops repeated identical tool calls that produce no new result', async () => {
    const repeatedTurn = (id: string): ModelEvent[] => [
      { type: 'tool_call_started', id, name: 'terminal_observe' },
      {
        type: 'tool_call_completed',
        id,
        name: 'terminal_observe',
        argumentsJson: '{"view":"output","afterCursor":0}',
      },
      { type: 'turn_completed', stopReason: 'tool_call' },
    ];
    const adapter = new ScriptedAdapter([
      repeatedTurn('call-1'),
      repeatedTurn('call-2'),
      [
        { type: 'text_delta', delta: 'would otherwise continue' },
        { type: 'turn_completed', stopReason: 'stop' },
      ],
    ]);
    const runtime = new AgentRuntime({
      task: task(),
      model: 'model-1',
      adapter,
      gateway: {
        call: async () => ({
          ok: true,
          result: { status: 'observed', cursor: 0, output: 'same output' },
        }),
      },
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: 'observe until changed' },
      maxRepeatedNoProgress: 2,
    });

    await expect(runtime.run()).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('repeated tool call made no progress'),
    });
    expect(adapter.requests).toHaveLength(2);
  });

  it('does not redispatch a command-not-found call without new evidence', async () => {
    const repeatedTurn = (id: string): ModelEvent[] => [
      { type: 'tool_call_started', id, name: 'terminal_execute' },
      {
        type: 'tool_call_completed',
        id,
        name: 'terminal_execute',
        argumentsJson: '{"command":"free -h"}',
      },
      { type: 'turn_completed', stopReason: 'tool_call' },
    ];
    const adapter = new ScriptedAdapter([
      repeatedTurn('call-1'),
      repeatedTurn('call-2'),
      [{ type: 'text_delta', delta: '当前系统不支持该命令。' }, { type: 'turn_completed' }],
    ]);
    let dispatches = 0;
    const runtime = new AgentRuntime({
      task: task(),
      model: 'model-1',
      adapter,
      gateway: {
        call: async () => {
          dispatches += 1;
          return {
            ok: true,
            result: {
              status: 'completed',
              transaction: { exitCode: 127 },
              output: { text: 'bash: free: command not found' },
            },
          };
        },
      },
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: 'inspect memory' },
    });

    await expect(runtime.run()).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('repeated command without new evidence'),
    });
    expect(dispatches).toBe(1);
    expect(adapter.requests).toHaveLength(2);
  });

  it('re-fits accumulated tool results before every model run', async () => {
    const maxInputTokens =
      estimateModelItemsTokens([{ role: 'system', content: AGENT_SYSTEM_PROMPT }]) + 180;
    const adapter = new ScriptedAdapter([
      [
        { type: 'tool_call_started', id: 'call-large', name: 'terminal_observe' },
        {
          type: 'tool_call_completed',
          id: 'call-large',
          name: 'terminal_observe',
          argumentsJson: '{}',
        },
        { type: 'turn_completed', stopReason: 'tool_call' },
      ],
      [
        { type: 'text_delta', delta: 'done' },
        { type: 'turn_completed', stopReason: 'stop' },
      ],
      [
        { type: 'text_delta', delta: 'done' },
        { type: 'turn_completed', stopReason: 'stop' },
      ],
    ]);
    const runtime = new AgentRuntime({
      task: task(),
      model: 'model-1',
      adapter,
      gateway: {
        call: async () => ({ ok: true, result: { status: 'observed', output: 'x'.repeat(4_000) } }),
      },
      contextBuilder: new ContextBuilder(),
      initialContext: { goal: 'inspect' },
      maxInputTokens,
    });

    await expect(runtime.run()).resolves.toMatchObject({ status: 'completed', answer: 'done' });
    expect(estimateModelItemsTokens(adapter.requests[1]!.items)).toBeLessThanOrEqual(
      maxInputTokens,
    );
    expect(adapter.requests[1]!.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'assistant_tool_call', toolCallId: 'call-large' }),
        expect.objectContaining({ type: 'tool_result', toolCallId: 'call-large' }),
      ]),
    );
  });
});
