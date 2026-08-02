/**
 * 契约测试：TestAgent / MockTerminalBackend 可独立替换
 *
 * 验证两层契约：
 * 1. 平台只依赖 AgentDriverInfo / AgentDriverEvent 抽象，TestAgent 与
 *    内置驱动者元信息可互换（驱动者维度可替换）；
 * 2. 平台通过能力声明决策 Terminal 操作，MockTerminalBackend 与手写
 *    最小后端对象走同一套 hasTerminalCapability / supportsExecutionDialect，
 *    "能力缺失" 被显式报告而非静默成功（后端维度可替换）。
 */
import { describe, expect, it } from 'vitest';

import {
  createBuiltinDriverInfo,
  hasTerminalCapability,
  supportsExecutionDialect,
  type TerminalBackendInfo,
} from '@synapse-term/domain';

import { MockTerminalBackend } from './mock-terminal-backend.js';
import { TestAgent } from './test-agent.js';

describe('TestAgent（驱动者测试替身）', () => {
  it('默认元信息符合 AgentDriver 契约，可替换内置驱动者', () => {
    const agent = new TestAgent();
    const builtin = createBuiltinDriverInfo();

    // 两者共享同一组元信息字段：id / kind / displayName / capabilities
    expect(agent.info).toMatchObject({
      id: 'test-agent',
      kind: 'acp',
      displayName: expect.any(String),
      capabilities: {
        selfManagedModel: true,
        permissionModes: ['manual', 'auto'],
      },
    });
    expect(builtin).toMatchObject({
      id: 'builtin',
      kind: 'builtin',
      capabilities: {
        selfManagedModel: false,
        permissionModes: ['manual', 'auto', 'full_access'],
      },
    });
  });

  it('脚本化事件按序产出并记录，工具调用同时进入记录', async () => {
    const agent = new TestAgent();
    agent.enqueueTurn([{ type: 'AgentStarted' }, { type: 'AgentTextDelta', delta: 'hello' }]);
    agent.requestToolCall({
      toolCallId: 'tool-1',
      name: 'terminal_execute',
      argumentsJson: '{"command":"echo hi"}',
    });

    const streamTypes: string[] = [];
    for await (const event of agent.stream()) streamTypes.push(event.type);

    // stream 按脚本队列产出（requestToolCall 属于直接 emit 路径，不混入队列）
    expect(streamTypes).toEqual(['AgentStarted', 'AgentTextDelta']);
    // 两条路径都写入记录：先直接 emit 1 个，随后 stream 产出 2 个
    expect(agent.recorded.events.map((e) => e.type)).toEqual([
      'AgentToolCallRequested',
      'AgentStarted',
      'AgentTextDelta',
    ]);
    expect(agent.toolCalls).toEqual([
      {
        toolCallId: 'tool-1',
        name: 'terminal_execute',
        argumentsJson: '{"command":"echo hi"}',
      },
    ]);
  });

  it('信号中断时抛出 AbortError，驱动者可被平台终止', async () => {
    const agent = new TestAgent();
    agent.enqueueTurn([{ type: 'AgentStarted' }, { type: 'AgentTextDelta', delta: 'partial' }]);
    const controller = new AbortController();
    controller.abort();

    await expect(async () => {
      for await (const _event of agent.stream(controller.signal)) {
        void _event;
        // 首个事件即应被中断
      }
    }).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('MockTerminalBackend（终端后端测试替身）', () => {
  it('默认声明本地 PTY 能力与方言，能力检查走契约函数', () => {
    const backend = new MockTerminalBackend();

    expect(backend.has('observeScreen')).toBe(true);
    expect(backend.has('structuredExecute')).toBe(true);
    expect(backend.supports('posix')).toBe(true);
    expect(backend.supports('powershell')).toBe(true);
  });

  it('能力缺失被显式报告（不静默成功）', () => {
    const minimal = new MockTerminalBackend({
      capabilities: ['observeScreen'],
      dialects: ['posix'],
    });

    expect(minimal.has('observeScreen')).toBe(true);
    expect(minimal.has('structuredExecute')).toBe(false);
    expect(minimal.supports('powershell')).toBe(false);
  });

  it('手写最小后端对象与 MockTerminalBackend 走同一契约（后端可替换）', () => {
    const handWritten: TerminalBackendInfo = {
      id: 'remote-terminal',
      displayName: '远端终端',
      capabilities: {
        capabilities: ['observeScreen', 'replayOutput'],
        dialects: ['posix'],
      },
    };
    const mock = new MockTerminalBackend({
      capabilities: ['observeScreen', 'replayOutput'],
      dialects: ['posix'],
    });

    // 同一组契约函数同时适用于手写对象与测试替身
    for (const backend of [handWritten, mock.info]) {
      expect(hasTerminalCapability(backend, 'observeScreen')).toBe(true);
      expect(hasTerminalCapability(backend, 'interrupt')).toBe(false);
      expect(supportsExecutionDialect(backend, 'posix')).toBe(true);
      expect(supportsExecutionDialect(backend, 'powershell')).toBe(false);
    }
  });
});
