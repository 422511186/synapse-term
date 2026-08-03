import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

import type {
  ModelConfiguration,
  ModelReasoningEffort,
  ProviderProfile,
} from '@synapse-term/domain';

import {
  streamWithPreEventRetry,
  type ModelAdapter,
  type ModelContentPart,
  type ModelEvent,
  type ModelImageMimeType,
  type ModelInputItem,
  type ModelRequest,
} from './model-adapter.js';

interface StreamingClient {
  create(request: Record<string, unknown>, signal?: AbortSignal): Promise<AsyncIterable<unknown>>;
}

interface AdapterOptions {
  client?: StreamingClient;
  apiKey?: string;
  baseUrl?: string;
  headers?: Readonly<Record<string, string>>;
  timeoutMs?: number;
  maxAttempts?: number;
  multimodal?: boolean;
  supportedReasoningEfforts?: readonly ModelReasoningEffort[];
}

export function createProviderAdapter(
  profile: ProviderProfile,
  modelOrApiKey: ModelConfiguration | string,
  configuredApiKey?: string,
): ModelAdapter {
  const model = typeof modelOrApiKey === 'string' ? undefined : modelOrApiKey;
  const apiKey = typeof modelOrApiKey === 'string' ? modelOrApiKey : configuredApiKey;
  if (apiKey === undefined) throw new Error('Provider API key is required');
  const options: AdapterOptions = {
    apiKey,
    baseUrl: profile.baseUrl,
    headers: profile.extraHeaders,
    timeoutMs: profile.timeoutMs,
    ...(model === undefined
      ? {}
      : {
          supportedReasoningEfforts:
            model.declaredCapabilities.reasoning === true ? model.supportedReasoningEfforts : [],
          multimodal: model.declaredCapabilities.multimodal === true,
        }),
  };
  switch (profile.protocol) {
    case 'openai_responses':
      return new OpenAIResponsesAdapter(options);
    case 'openai_chat_completions':
      return new OpenAIChatCompletionsAdapter(options);
    case 'anthropic_messages':
      return new AnthropicMessagesAdapter(options);
  }
}

export class OpenAIResponsesAdapter implements ModelAdapter {
  readonly #client: StreamingClient;
  readonly #maxAttempts: number;
  readonly #supportedReasoningEfforts: readonly ModelReasoningEffort[] | undefined;
  readonly #multimodal: boolean;

  constructor(options: AdapterOptions = {}) {
    this.#client = options.client ?? createOpenAIResponsesClient(options);
    this.#maxAttempts = options.maxAttempts ?? 2;
    this.#supportedReasoningEfforts = options.supportedReasoningEfforts;
    this.#multimodal = options.multimodal === true;
  }

  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelEvent> {
    assertMultimodalRequest(request, this.#multimodal);
    const calls = new Map<string, { id: string; name: string }>();
    try {
      const events = streamWithPreEventRetry(
        () =>
          this.#client.create(
            buildResponsesRequest(request, this.#supportedReasoningEfforts),
            signal,
          ),
        { maxAttempts: this.#maxAttempts, ...(signal === undefined ? {} : { signal }) },
      );
      for await (const raw of events) {
        const event = record(raw);
        const type = stringValue(event.type);
        if (type === 'response.output_text.delta') {
          const delta = stringValue(event.delta);
          if (delta !== undefined) yield { type: 'text_delta', delta };
          continue;
        }
        if (type === 'response.output_item.added') {
          const item = record(event.item);
          if (item.type !== 'function_call') continue;
          const itemId = stringValue(item.id);
          const id = stringValue(item.call_id);
          const name = stringValue(item.name);
          if (itemId === undefined || id === undefined || name === undefined) continue;
          calls.set(itemId, { id, name });
          yield { type: 'tool_call_started', id, name };
          continue;
        }
        if (type === 'response.function_call_arguments.delta') {
          const call = calls.get(stringValue(event.item_id) ?? '');
          const delta = stringValue(event.delta);
          if (call !== undefined && delta !== undefined) {
            yield { type: 'tool_call_delta', id: call.id, delta };
          }
          continue;
        }
        if (type === 'response.output_item.done') {
          const item = record(event.item);
          if (item.type !== 'function_call') continue;
          const id = stringValue(item.call_id);
          const name = stringValue(item.name);
          const argumentsJson = stringValue(item.arguments);
          if (id !== undefined && name !== undefined && argumentsJson !== undefined) {
            yield { type: 'tool_call_completed', id, name, argumentsJson };
          }
          continue;
        }
        if (type === 'response.completed') {
          const response = record(event.response);
          const usage = record(response.usage);
          yield {
            type: 'usage',
            inputTokens: numberValue(usage.input_tokens) ?? 0,
            outputTokens: numberValue(usage.output_tokens) ?? 0,
          };
          const stopReason = stringValue(response.status);
          yield { type: 'turn_completed', ...(stopReason === undefined ? {} : { stopReason }) };
        }
      }
    } catch (error) {
      if (isAbort(error)) throw error;
      yield providerError(error);
    }
  }
}

export class OpenAIChatCompletionsAdapter implements ModelAdapter {
  readonly #client: StreamingClient;
  readonly #maxAttempts: number;
  readonly #supportedReasoningEfforts: readonly ModelReasoningEffort[] | undefined;
  readonly #multimodal: boolean;

  constructor(options: AdapterOptions = {}) {
    this.#client = options.client ?? createOpenAIChatClient(options);
    this.#maxAttempts = options.maxAttempts ?? 8;
    this.#supportedReasoningEfforts = options.supportedReasoningEfforts;
    this.#multimodal = options.multimodal === true;
  }

  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelEvent> {
    assertMultimodalRequest(request, this.#multimodal);
    const calls = new Map<
      number,
      { id: string; name: string; argumentsJson: string; completed: boolean }
    >();
    let stopReason: string | undefined;
    try {
      const primaryRequest = buildChatRequest(request, this.#supportedReasoningEfforts);
      const compatibilityRequest = { ...primaryRequest };
      delete compatibilityRequest.stream_options;
      let setupAttempt = 0;
      const chunks = streamWithPreEventRetry(
        () =>
          this.#client.create(setupAttempt++ === 0 ? primaryRequest : compatibilityRequest, signal),
        { maxAttempts: this.#maxAttempts, ...(signal === undefined ? {} : { signal }) },
      );
      for await (const raw of chunks) {
        const chunk = record(raw);
        const usage = record(chunk.usage);
        if (Object.keys(usage).length > 0) {
          yield {
            type: 'usage',
            inputTokens: numberValue(usage.prompt_tokens) ?? 0,
            outputTokens: numberValue(usage.completion_tokens) ?? 0,
          };
        }
        const choice = arrayValue(chunk.choices).map(record)[0];
        if (choice === undefined) continue;
        const delta = record(choice.delta);
        const content = stringValue(delta.content);
        if (content !== undefined && content.length > 0)
          yield { type: 'text_delta', delta: content };

        for (const toolValue of arrayValue(delta.tool_calls)) {
          const tool = record(toolValue);
          const index = numberValue(tool.index);
          if (index === undefined) continue;
          const fn = record(tool.function);
          let call = calls.get(index);
          if (call === undefined) {
            const id = stringValue(tool.id);
            const name = stringValue(fn.name);
            if (id === undefined || name === undefined) continue;
            call = { id, name, argumentsJson: '', completed: false };
            calls.set(index, call);
            yield { type: 'tool_call_started', id, name };
          }
          const argumentsDelta = stringValue(fn.arguments);
          if (argumentsDelta !== undefined && argumentsDelta.length > 0) {
            call.argumentsJson += argumentsDelta;
            yield { type: 'tool_call_delta', id: call.id, delta: argumentsDelta };
          }
        }

        const chunkStopReason = stringValue(choice.finish_reason);
        if (chunkStopReason !== undefined) {
          stopReason = chunkStopReason;
          for (const call of calls.values()) {
            if (call.completed) continue;
            call.completed = true;
            yield {
              type: 'tool_call_completed',
              id: call.id,
              name: call.name,
              argumentsJson: call.argumentsJson,
            };
          }
        }
      }
      if (stopReason !== undefined) yield { type: 'turn_completed', stopReason };
    } catch (error) {
      if (isAbort(error)) throw error;
      yield providerError(error);
    }
  }
}

export class AnthropicMessagesAdapter implements ModelAdapter {
  readonly #client: StreamingClient;
  readonly #maxAttempts: number;
  readonly #supportedReasoningEfforts: readonly ModelReasoningEffort[] | undefined;
  readonly #multimodal: boolean;

  constructor(options: AdapterOptions = {}) {
    this.#client = options.client ?? createAnthropicClient(options);
    this.#maxAttempts = options.maxAttempts ?? 2;
    this.#supportedReasoningEfforts = options.supportedReasoningEfforts;
    this.#multimodal = options.multimodal === true;
  }

  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelEvent> {
    assertMultimodalRequest(request, this.#multimodal);
    const calls = new Map<number, { id: string; name: string; argumentsJson: string }>();
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | undefined;
    try {
      const events = streamWithPreEventRetry(
        () =>
          this.#client.create(
            buildAnthropicRequest(request, this.#supportedReasoningEfforts),
            signal,
          ),
        { maxAttempts: this.#maxAttempts, ...(signal === undefined ? {} : { signal }) },
      );
      for await (const raw of events) {
        const event = record(raw);
        const type = stringValue(event.type);
        if (type === 'message_start') {
          inputTokens =
            numberValue(record(record(event.message).usage).input_tokens) ?? inputTokens;
          continue;
        }
        if (type === 'content_block_start') {
          const block = record(event.content_block);
          if (block.type !== 'tool_use') continue;
          const index = numberValue(event.index);
          const id = stringValue(block.id);
          const name = stringValue(block.name);
          if (index === undefined || id === undefined || name === undefined) continue;
          calls.set(index, { id, name, argumentsJson: '' });
          yield { type: 'tool_call_started', id, name };
          continue;
        }
        if (type === 'content_block_delta') {
          const delta = record(event.delta);
          if (delta.type === 'text_delta') {
            const text = stringValue(delta.text);
            if (text !== undefined) yield { type: 'text_delta', delta: text };
            continue;
          }
          if (delta.type === 'input_json_delta') {
            const call = calls.get(numberValue(event.index) ?? -1);
            const partialJson = stringValue(delta.partial_json);
            if (call !== undefined && partialJson !== undefined) {
              call.argumentsJson += partialJson;
              yield { type: 'tool_call_delta', id: call.id, delta: partialJson };
            }
          }
          continue;
        }
        if (type === 'content_block_stop') {
          const call = calls.get(numberValue(event.index) ?? -1);
          if (call !== undefined) {
            yield {
              type: 'tool_call_completed',
              id: call.id,
              name: call.name,
              argumentsJson: call.argumentsJson,
            };
          }
          continue;
        }
        if (type === 'message_delta') {
          stopReason = stringValue(record(event.delta).stop_reason) ?? stopReason;
          outputTokens = numberValue(record(event.usage).output_tokens) ?? outputTokens;
          continue;
        }
        if (type === 'message_stop') {
          yield { type: 'usage', inputTokens, outputTokens };
          yield { type: 'turn_completed', ...(stopReason === undefined ? {} : { stopReason }) };
        }
      }
    } catch (error) {
      if (isAbort(error)) throw error;
      yield providerError(error);
    }
  }
}

function createOpenAIResponsesClient(options: AdapterOptions): StreamingClient {
  const client = new OpenAI(openAIOptions(options));
  return {
    create: async (request, signal) =>
      (await client.responses.create(request as never, {
        signal,
      })) as unknown as AsyncIterable<unknown>,
  };
}

function createOpenAIChatClient(options: AdapterOptions): StreamingClient {
  const client = new OpenAI(openAIOptions(options));
  return {
    create: async (request, signal) =>
      (await client.chat.completions.create(request as never, {
        signal,
      })) as unknown as AsyncIterable<unknown>,
  };
}

function createAnthropicClient(options: AdapterOptions): StreamingClient {
  const client = new Anthropic({
    apiKey: options.apiKey ?? 'missing-api-key',
    ...(options.baseUrl === undefined ? {} : { baseURL: options.baseUrl }),
    ...(options.headers === undefined ? {} : { defaultHeaders: { ...options.headers } }),
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
    maxRetries: 0,
  });
  return {
    create: async (request, signal) =>
      (await client.messages.create(request as never, {
        signal,
      })) as unknown as AsyncIterable<unknown>,
  };
}

function openAIOptions(options: AdapterOptions): ConstructorParameters<typeof OpenAI>[0] {
  return {
    apiKey: options.apiKey ?? 'missing-api-key',
    ...(options.baseUrl === undefined ? {} : { baseURL: options.baseUrl }),
    ...(options.headers === undefined ? {} : { defaultHeaders: { ...options.headers } }),
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
    maxRetries: 0,
  };
}

function buildResponsesRequest(
  request: ModelRequest,
  supportedReasoningEfforts?: readonly ModelReasoningEffort[],
): Record<string, unknown> {
  return {
    model: request.model,
    input: request.items.map(responseInputItem),
    stream: true,
    ...(request.tools === undefined
      ? {}
      : {
          tools: request.tools.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
            strict: true,
          })),
        }),
    ...(request.maxOutputTokens === undefined
      ? {}
      : { max_output_tokens: request.maxOutputTokens }),
    ...(!supportsReasoningEffort(request.reasoningEffort, supportedReasoningEfforts)
      ? {}
      : { reasoning: { effort: request.reasoningEffort } }),
  };
}

function buildChatRequest(
  request: ModelRequest,
  supportedReasoningEfforts?: readonly ModelReasoningEffort[],
): Record<string, unknown> {
  return {
    model: request.model,
    messages: request.items.map(chatInputItem),
    stream: true,
    stream_options: { include_usage: true },
    ...(request.tools === undefined
      ? {}
      : {
          tools: request.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
        }),
    ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
    ...(!supportsReasoningEffort(request.reasoningEffort, supportedReasoningEfforts)
      ? {}
      : { reasoning_effort: request.reasoningEffort }),
  };
}

function buildAnthropicRequest(
  request: ModelRequest,
  supportedReasoningEfforts?: readonly ModelReasoningEffort[],
): Record<string, unknown> {
  const system = request.items
    .filter((item) => 'role' in item && item.role === 'system')
    .map((item) => {
      if (!('role' in item) || typeof item.content === 'string') {
        return 'role' in item && typeof item.content === 'string' ? item.content : '';
      }
      return item.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');
    })
    .join('\n');
  return {
    model: request.model,
    max_tokens: request.maxOutputTokens ?? 4096,
    messages: request.items.filter(notSystemItem).map(anthropicInputItem),
    stream: true,
    ...(system.length === 0 ? {} : { system }),
    ...(request.tools === undefined
      ? {}
      : {
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema,
          })),
        }),
    ...anthropicThinking(request, supportedReasoningEfforts),
  };
}

function anthropicThinking(
  request: ModelRequest,
  supportedReasoningEfforts?: readonly ModelReasoningEffort[],
): Record<string, unknown> {
  if (!supportsReasoningEffort(request.reasoningEffort, supportedReasoningEfforts)) return {};
  const requestedBudget =
    request.reasoningEffort === 'low'
      ? 1_024
      : request.reasoningEffort === 'medium'
        ? 4_096
        : request.reasoningEffort === 'high'
          ? 8_192
          : 16_384;
  const maxTokens = request.maxOutputTokens ?? 4_096;
  const budgetTokens = Math.min(requestedBudget, maxTokens - 1);
  if (budgetTokens < 1_024) return {};
  return { thinking: { type: 'enabled', budget_tokens: budgetTokens } };
}

function responseInputItem(item: ModelInputItem): Record<string, unknown> {
  if ('role' in item) return { role: item.role, content: responseMessageContent(item.content) };
  if (item.type === 'assistant_tool_call') {
    return {
      type: 'function_call',
      call_id: item.toolCallId,
      name: item.name,
      arguments: item.argumentsJson,
    };
  }
  return {
    type: 'function_call_output',
    call_id: item.toolCallId,
    output: item.content,
  };
}

function chatInputItem(item: ModelInputItem): Record<string, unknown> {
  if ('role' in item) return { role: item.role, content: chatMessageContent(item.content) };
  if (item.type === 'assistant_tool_call') {
    return {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: item.toolCallId,
          type: 'function',
          function: { name: item.name, arguments: item.argumentsJson },
        },
      ],
    };
  }
  return { role: 'tool', tool_call_id: item.toolCallId, content: item.content };
}

function notSystemItem(item: ModelInputItem): boolean {
  return !('role' in item && item.role === 'system');
}

function anthropicInputItem(item: ModelInputItem): Record<string, unknown> {
  if ('role' in item) {
    return {
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: anthropicMessageContent(item.content),
    };
  }
  if (item.type === 'assistant_tool_call') {
    return {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: item.toolCallId,
          name: item.name,
          input: parseArguments(item.argumentsJson),
        },
      ],
    };
  }
  return {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: item.toolCallId,
        content: item.content,
        is_error: item.isError,
      },
    ],
  };
}

function responseMessageContent(content: string | readonly ModelContentPart[]): unknown {
  if (typeof content === 'string') return content;
  return content.map((part) =>
    part.type === 'image'
      ? { type: 'input_image', image_url: imageDataUrl(part) }
      : { type: 'input_text', text: part.text },
  );
}

function chatMessageContent(content: string | readonly ModelContentPart[]): unknown {
  if (typeof content === 'string') return content;
  return content.map((part) =>
    part.type === 'image'
      ? { type: 'image_url', image_url: { url: imageDataUrl(part) } }
      : { type: 'text', text: part.text },
  );
}

function anthropicMessageContent(content: string | readonly ModelContentPart[]): unknown {
  if (typeof content === 'string') return content;
  return content.map((part) =>
    part.type === 'image'
      ? {
          type: 'image',
          source: {
            type: 'base64',
            media_type: part.mimeType,
            data: part.dataBase64,
          },
        }
      : { type: 'text', text: part.text },
  );
}

function imageDataUrl(part: Extract<ModelContentPart, { type: 'image' }>): string {
  return `data:${part.mimeType};base64,${part.dataBase64}`;
}

function assertMultimodalRequest(request: ModelRequest, multimodal: boolean): void {
  const supportedImageMimes = new Set<ModelImageMimeType>([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
  ]);
  for (const item of request.items) {
    if (!('role' in item) || typeof item.content === 'string') continue;
    for (const part of item.content) {
      if (part.type !== 'image') continue;
      if (!multimodal) {
        throw new Error('multimodal_unsupported: 当前模型不支持图片输入。');
      }
      if (!supportedImageMimes.has(part.mimeType)) {
        throw new Error(`unsupported_image_mime: ${part.mimeType}`);
      }
      if (typeof part.dataBase64 !== 'string' || part.dataBase64.length === 0) {
        throw new Error('image_data_missing: 图片内容缺少 base64 数据。');
      }
    }
  }
}

function parseArguments(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function providerError(error: unknown): ModelEvent {
  const evidence = providerErrorEvidence(error);
  return {
    type: 'provider_error',
    code: evidence.code,
    message: evidence.message,
    retryable: false,
  };
}

function supportsReasoningEffort(
  effort: ModelReasoningEffort | undefined,
  supportedReasoningEfforts: readonly ModelReasoningEffort[] | undefined,
): effort is ModelReasoningEffort {
  return (
    effort !== undefined &&
    (supportedReasoningEfforts === undefined || supportedReasoningEfforts.includes(effort))
  );
}

function providerErrorEvidence(error: unknown): { code: string; message: string } {
  const pending: unknown[] = [error];
  const visited = new Set<unknown>();
  const codes: string[] = [];
  const messages: string[] = [];
  while (pending.length > 0 && visited.size < 8) {
    const current = pending.shift();
    if (current === undefined || current === null || visited.has(current)) continue;
    visited.add(current);
    const value = record(current);
    const code = stringValue(value.code);
    if (code !== undefined && !codes.includes(code)) codes.push(code);
    const message = current instanceof Error ? current.message : stringValue(value.message);
    if (message !== undefined && message.length > 0 && !messages.includes(message)) {
      messages.push(message);
    }
    if (value.cause !== undefined) pending.push(value.cause);
    if (Array.isArray(value.errors)) pending.push(...value.errors);
  }
  return {
    code: codes.at(-1) ?? 'provider_stream_error',
    message: (messages.join(' | ') || String(error)).slice(0, 1_000),
  };
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
