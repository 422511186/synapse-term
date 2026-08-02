import type { ModelEvent } from '@synapse-term/model-providers';

export interface AssembledToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface PendingCall {
  name: string;
  argumentsJson: string;
}

export class ToolCallAssembler {
  readonly #calls = new Map<string, PendingCall>();

  accept(
    event: Extract<ModelEvent, { type: `tool_call_${string}` }>,
  ): AssembledToolCall | undefined {
    if (event.type === 'tool_call_started') {
      if (this.#calls.has(event.id)) throw new Error(`duplicate tool call ${event.id}`);
      this.#calls.set(event.id, { name: event.name, argumentsJson: '' });
      return undefined;
    }
    const pending = this.#calls.get(event.id);
    if (pending === undefined) throw new Error(`tool call ${event.id} was not started`);
    if (event.type === 'tool_call_delta') {
      pending.argumentsJson += event.delta;
      return undefined;
    }
    if (pending.name !== event.name) throw new Error(`tool call ${event.id} changed name`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.argumentsJson || pending.argumentsJson || '{}');
    } catch {
      throw new Error(`tool call ${event.id} has malformed JSON arguments`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`tool call ${event.id} arguments must be an object`);
    }
    this.#calls.delete(event.id);
    return { id: event.id, name: event.name, arguments: parsed as Record<string, unknown> };
  }

  reset(): void {
    this.#calls.clear();
  }
}
