/**
 * TestAgent：脚本化 Agent 驱动者测试替身（契约测试与后续 ACP 驱动测试共用）
 *
 * 遵循 packages/domain 的 AgentDriver 契约：平台只消费 AgentDriverInfo 与
 * AgentDriverEvent，TestAgent 通过 enqueueTurn 脚本化事件序列，替代真实
 * 内置 Agent 或外部 ACP 子进程，验证驱动者可独立替换。
 */
import type {
  AgentDriverEvent,
  AgentDriverInfo,
  AgentPermissionMode,
  ToolCallInvocation,
} from '@synapse-term/domain';

import { EventRecorder } from './event-recorder.js';

export interface TestAgentOptions {
  /** 驱动者唯一标识（默认 'test-agent'） */
  readonly id?: string;
  /** 驱动者种类（默认 'acp'，模拟外部驱动者） */
  readonly kind?: 'builtin' | 'acp';
  readonly displayName?: string;
  /** 是否自带模型与推理循环（默认 true，模拟外部 Agent） */
  readonly selfManagedModel?: boolean;
  readonly permissionModes?: readonly AgentPermissionMode[];
}

export class TestAgent {
  /** 平台视角的驱动者元信息 */
  readonly info: AgentDriverInfo;
  /** 驱动者产出的事件记录（供断言使用） */
  readonly recorded = new EventRecorder<AgentDriverEvent>();
  /** 驱动者提出的工具调用记录 */
  readonly toolCalls: ToolCallInvocation[] = [];

  #scriptedTurns: Array<readonly AgentDriverEvent[]> = [];

  constructor(options: TestAgentOptions = {}) {
    this.info = {
      id: options.id ?? 'test-agent',
      kind: options.kind ?? 'acp',
      displayName: options.displayName ?? '测试驱动者',
      capabilities: {
        selfManagedModel: options.selfManagedModel ?? true,
        permissionModes: options.permissionModes ?? ['manual', 'auto'],
      },
    };
  }

  /** 脚本化一轮驱动者事件（下一轮调用 stream 时按序产出） */
  enqueueTurn(events: readonly AgentDriverEvent[]): void {
    this.#scriptedTurns.push([...events]);
  }

  /** 模拟驱动者提出一次工具调用（同时记录与产出事件） */
  requestToolCall(call: ToolCallInvocation): void {
    this.toolCalls.push(call);
    this.emit({
      type: 'AgentToolCallRequested',
      toolCallId: call.toolCallId,
      name: call.name,
      argumentsJson: call.argumentsJson,
    });
  }

  /** 主动产出一个驱动者事件（外部测试驱动） */
  emit(event: AgentDriverEvent): void {
    this.recorded.record(event);
  }

  /**
   * 驱动者事件流：按脚本顺序产出，支持 AbortSignal 中断；
   * 每个事件同时写入 recorded，供时间线/审计断言使用。
   */
  async *stream(signal?: AbortSignal): AsyncIterable<AgentDriverEvent> {
    while (this.#scriptedTurns.length > 0) {
      const turn = this.#scriptedTurns.shift()!;
      for (const event of turn) {
        if (signal?.aborted) {
          const error = new Error('test agent stream aborted');
          error.name = 'AbortError';
          throw error;
        }
        this.recorded.record(event);
        yield event;
      }
    }
  }
}

/** 构造一个默认 TestAgent（方便一行创建） */
export function createTestAgent(options: TestAgentOptions = {}): TestAgent {
  return new TestAgent(options);
}
