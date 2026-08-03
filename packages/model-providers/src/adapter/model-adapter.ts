import type { ReasoningEffort } from '@synapse-term/domain';

export type ModelImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export interface ModelTextContentPart {
  type: 'text';
  text: string;
}

export interface ModelImageContentPart {
  type: 'image';
  mimeType: ModelImageMimeType;
  dataBase64: string;
}

export type ModelContentPart = ModelTextContentPart | ModelImageContentPart;

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | readonly ModelContentPart[];
}

export type ModelInputItem =
  | ModelMessage
  | {
      type: 'assistant_tool_call';
      toolCallId: string;
      name: string;
      argumentsJson: string;
    }
  | {
      type: 'tool_result';
      toolCallId: string;
      content: string;
      isError: boolean;
    };

export interface ModelToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ModelRequest {
  model: string;
  items: readonly ModelInputItem[];
  tools?: readonly ModelToolDefinition[];
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
}

export type ModelEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call_started'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; delta: string }
  | { type: 'tool_call_completed'; id: string; name: string; argumentsJson: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'turn_completed'; stopReason?: string }
  | { type: 'provider_error'; code: string; message: string; retryable: boolean };

export interface ModelAdapter {
  stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelEvent>;
}

export async function collectModelEvents(events: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const collected: ModelEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

export async function* streamWithPreEventRetry<T>(
  factory: () => Promise<AsyncIterable<T>>,
  options: { maxAttempts?: number; signal?: AbortSignal } = {},
): AsyncIterable<T> {
  const maxAttempts = options.maxAttempts ?? 2;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('maxAttempts must be a positive integer');
  }

  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    let emitted = false;
    try {
      if (options.signal?.aborted) throw abortError();
      const events = await factory();
      for await (const event of events) {
        if (options.signal?.aborted) throw abortError();
        emitted = true;
        yield event;
      }
      return;
    } catch (error) {
      if (options.signal?.aborted || emitted || attempt >= maxAttempts) throw error;
    }
  }
}

function abortError(): Error {
  const error = new Error('model stream aborted');
  error.name = 'AbortError';
  return error;
}
