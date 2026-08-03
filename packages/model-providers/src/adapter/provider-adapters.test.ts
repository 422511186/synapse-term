import { describe, expect, it } from 'vitest';

import { collectModelEvents, type ModelRequest } from './model-adapter.js';
import {
  AnthropicMessagesAdapter,
  OpenAIChatCompletionsAdapter,
  OpenAIResponsesAdapter,
} from './provider-adapters.js';

const request: ModelRequest = {
  model: 'test-model',
  items: [{ role: 'user', content: 'inspect disk' }],
  tools: [
    {
      name: 'terminal_execute',
      description: 'Execute a command',
      inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
    },
  ],
};

async function* fixture<T>(events: readonly T[]): AsyncIterable<T> {
  yield* events;
}

describe('provider adapters', () => {
  it('normalizes OpenAI Responses streaming events', async () => {
    const client = {
      create: async () =>
        fixture([
          { type: 'response.output_text.delta', delta: 'checking' },
          {
            type: 'response.output_item.added',
            item: {
              id: 'item-1',
              type: 'function_call',
              call_id: 'call-1',
              name: 'terminal_execute',
            },
          },
          {
            type: 'response.function_call_arguments.delta',
            item_id: 'item-1',
            delta: '{"command":"df -h"}',
          },
          {
            type: 'response.output_item.done',
            item: {
              id: 'item-1',
              type: 'function_call',
              call_id: 'call-1',
              name: 'terminal_execute',
              arguments: '{"command":"df -h"}',
            },
          },
          {
            type: 'response.completed',
            response: { usage: { input_tokens: 10, output_tokens: 5 }, status: 'completed' },
          },
        ]),
    };

    await expect(
      collectModelEvents(new OpenAIResponsesAdapter({ client }).stream(request)),
    ).resolves.toEqual([
      { type: 'text_delta', delta: 'checking' },
      { type: 'tool_call_started', id: 'call-1', name: 'terminal_execute' },
      { type: 'tool_call_delta', id: 'call-1', delta: '{"command":"df -h"}' },
      {
        type: 'tool_call_completed',
        id: 'call-1',
        name: 'terminal_execute',
        argumentsJson: '{"command":"df -h"}',
      },
      { type: 'usage', inputTokens: 10, outputTokens: 5 },
      { type: 'turn_completed', stopReason: 'completed' },
    ]);
  });

  it('normalizes OpenAI-compatible Chat Completions chunks', async () => {
    const client = {
      create: async () =>
        fixture([
          { choices: [{ delta: { content: 'checking' }, finish_reason: null }] },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-1',
                      function: { name: 'terminal_execute', arguments: '{"command":' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                delta: { tool_calls: [{ index: 0, function: { arguments: '"df -h"}' } }] },
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 8, completion_tokens: 4 },
          },
        ]),
    };

    const events = await collectModelEvents(
      new OpenAIChatCompletionsAdapter({ client }).stream(request),
    );
    expect(events).toContainEqual({ type: 'text_delta', delta: 'checking' });
    expect(events).toContainEqual({
      type: 'tool_call_completed',
      id: 'call-1',
      name: 'terminal_execute',
      argumentsJson: '{"command":"df -h"}',
    });
    expect(events).toContainEqual({ type: 'usage', inputTokens: 8, outputTokens: 4 });
    expect(events.at(-1)).toEqual({ type: 'turn_completed', stopReason: 'tool_calls' });
  });

  it('retries Chat Completions without optional stream usage metadata', async () => {
    const captured: Record<string, unknown>[] = [];
    const adapter = new OpenAIChatCompletionsAdapter({
      maxAttempts: 2,
      client: {
        create: async (value) => {
          captured.push(value);
          if (captured.length === 1) throw new Error('400 unsupported stream_options');
          return fixture([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]);
        },
      },
    });

    await expect(collectModelEvents(adapter.stream(request))).resolves.toContainEqual({
      type: 'text_delta',
      delta: 'ok',
    });
    expect(captured[0]).toHaveProperty('stream_options');
    expect(captured[1]).not.toHaveProperty('stream_options');
  });

  it('tolerates several Chat Completions routing failures before streaming starts', async () => {
    let attempts = 0;
    const adapter = new OpenAIChatCompletionsAdapter({
      client: {
        create: async () => {
          attempts += 1;
          if (attempts < 8) throw new Error('400 Upstream error: 400');
          return fixture([{ choices: [{ delta: { content: 'ready' }, finish_reason: 'stop' }] }]);
        },
      },
    });

    await expect(collectModelEvents(adapter.stream(request))).resolves.toContainEqual({
      type: 'text_delta',
      delta: 'ready',
    });
    expect(attempts).toBe(8);
  });

  it('uses eight pre-stream setup attempts by default for compatible gateways', async () => {
    let attempts = 0;
    const events = await collectModelEvents(
      new OpenAIChatCompletionsAdapter({
        client: {
          create: async () => {
            attempts += 1;
            throw new Error('upstream rejected before streaming');
          },
        },
      }).stream(request),
    );

    expect(attempts).toBe(8);
    expect(events.at(-1)).toMatchObject({ type: 'provider_error' });
  });

  it('normalizes Anthropic Messages content and tool use events', async () => {
    const client = {
      create: async () =>
        fixture([
          { type: 'message_start', message: { usage: { input_tokens: 7 } } },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'checking' },
          },
          {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'tool_use', id: 'call-1', name: 'terminal_execute' },
          },
          {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: '{"command":"df -h"}' },
          },
          { type: 'content_block_stop', index: 1 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'tool_use' },
            usage: { output_tokens: 3 },
          },
          { type: 'message_stop' },
        ]),
    };

    const events = await collectModelEvents(
      new AnthropicMessagesAdapter({ client }).stream(request),
    );
    expect(events).toContainEqual({ type: 'text_delta', delta: 'checking' });
    expect(events).toContainEqual({
      type: 'tool_call_completed',
      id: 'call-1',
      name: 'terminal_execute',
      argumentsJson: '{"command":"df -h"}',
    });
    expect(events).toContainEqual({ type: 'usage', inputTokens: 7, outputTokens: 3 });
    expect(events.at(-1)).toEqual({ type: 'turn_completed', stopReason: 'tool_use' });
  });

  it('maps structured tool history to OpenAI Responses input items', async () => {
    const captured: Record<string, unknown>[] = [];
    const client = {
      create: async (value: Record<string, unknown>) => {
        captured.push(value);
        return fixture([
          { type: 'response.completed', response: { usage: {}, status: 'completed' } },
        ]);
      },
    };
    const adapter = new OpenAIResponsesAdapter({ client });
    await collectModelEvents(
      adapter.stream({
        ...request,
        items: [
          { role: 'user', content: 'inspect disk' },
          {
            type: 'assistant_tool_call',
            toolCallId: 'call-1',
            name: 'terminal_execute',
            argumentsJson: '{"command":"df -h"}',
          },
          {
            type: 'tool_result',
            toolCallId: 'call-1',
            content: '{"status":"completed"}',
            isError: false,
          },
        ],
      }),
    );

    expect(captured[0]?.input).toEqual([
      { role: 'user', content: 'inspect disk' },
      {
        type: 'function_call',
        call_id: 'call-1',
        name: 'terminal_execute',
        arguments: '{"command":"df -h"}',
      },
      {
        type: 'function_call_output',
        call_id: 'call-1',
        output: '{"status":"completed"}',
      },
    ]);
  });

  it('maps image content parts to OpenAI Responses input_image items', async () => {
    const captured: Record<string, unknown>[] = [];
    const client = {
      create: async (value: Record<string, unknown>) => {
        captured.push(value);
        return fixture([
          { type: 'response.completed', response: { usage: {}, status: 'completed' } },
        ]);
      },
    };
    await collectModelEvents(
      new OpenAIResponsesAdapter({ client, multimodal: true }).stream({
        model: 'test-model',
        items: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'describe this image' },
              { type: 'image', mimeType: 'image/png', dataBase64: 'aGVsbG8=' },
            ],
          },
        ],
      }),
    );

    expect(captured[0]?.input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'describe this image' },
          { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' },
        ],
      },
    ]);
  });

  it('maps image content parts to Chat Completions image_url blocks', async () => {
    const captured: Record<string, unknown>[] = [];
    const client = {
      create: async (value: Record<string, unknown>) => {
        captured.push(value);
        return fixture([{ choices: [{ delta: {}, finish_reason: 'stop' }] }]);
      },
    };
    await collectModelEvents(
      new OpenAIChatCompletionsAdapter({ client, multimodal: true }).stream({
        model: 'test-model',
        items: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'describe this image' },
              { type: 'image', mimeType: 'image/jpeg', dataBase64: 'aGVsbG8=' },
            ],
          },
        ],
      }),
    );

    expect(captured[0]?.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe this image' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/jpeg;base64,aGVsbG8=' },
          },
        ],
      },
    ]);
  });

  it('maps image content parts to Anthropic base64 image blocks', async () => {
    const captured: Record<string, unknown>[] = [];
    const client = {
      create: async (value: Record<string, unknown>) => {
        captured.push(value);
        return fixture([{ type: 'message_stop' }]);
      },
    };
    await collectModelEvents(
      new AnthropicMessagesAdapter({ client, multimodal: true }).stream({
        model: 'test-model',
        items: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'describe this image' },
              { type: 'image', mimeType: 'image/webp', dataBase64: 'aGVsbG8=' },
            ],
          },
        ],
      }),
    );

    expect(captured[0]?.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe this image' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/webp',
              data: 'aGVsbG8=',
            },
          },
        ],
      },
    ]);
  });

  it('rejects image parts before sending when multimodal is not declared', async () => {
    await expect(
      collectModelEvents(
        new OpenAIResponsesAdapter({ multimodal: false }).stream({
          model: 'test-model',
          items: [
            {
              role: 'user',
              content: [{ type: 'image', mimeType: 'image/png', dataBase64: 'aGVsbG8=' }],
            },
          ],
        }),
      ),
    ).rejects.toThrow('multimodal_unsupported');
  });

  it('rejects unsupported image MIME and missing base64 data', async () => {
    const imagePart = {
      type: 'image' as const,
      mimeType: 'image/svg+xml' as never,
      dataBase64: 'aGVsbG8=',
    };
    await expect(
      collectModelEvents(
        new OpenAIChatCompletionsAdapter({ multimodal: true }).stream({
          model: 'test-model',
          items: [{ role: 'user', content: [imagePart] }],
        }),
      ),
    ).rejects.toThrow('unsupported_image_mime');

    await expect(
      collectModelEvents(
        new AnthropicMessagesAdapter({ multimodal: true }).stream({
          model: 'test-model',
          items: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  mimeType: 'image/png',
                  dataBase64: '',
                },
              ],
            },
          ],
        }),
      ),
    ).rejects.toThrow('image_data_missing');
  });

  it('maps structured tool history to Chat Completions messages', async () => {
    const captured: Record<string, unknown>[] = [];
    const client = {
      create: async (value: Record<string, unknown>) => {
        captured.push(value);
        return fixture([{ choices: [{ delta: {}, finish_reason: 'stop' }] }]);
      },
    };
    await collectModelEvents(
      new OpenAIChatCompletionsAdapter({ client }).stream({
        ...request,
        items: [
          { role: 'user', content: 'inspect disk' },
          {
            type: 'assistant_tool_call',
            toolCallId: 'call-1',
            name: 'terminal_execute',
            argumentsJson: '{"command":"df -h"}',
          },
          {
            type: 'tool_result',
            toolCallId: 'call-1',
            content: '{"status":"completed"}',
            isError: false,
          },
        ],
      }),
    );

    expect(captured[0]?.messages).toEqual([
      { role: 'user', content: 'inspect disk' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'terminal_execute', arguments: '{"command":"df -h"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call-1', content: '{"status":"completed"}' },
    ]);
  });

  it('maps structured tool history to Anthropic tool_use and tool_result blocks', async () => {
    const captured: Record<string, unknown>[] = [];
    const client = {
      create: async (value: Record<string, unknown>) => {
        captured.push(value);
        return fixture([{ type: 'message_stop' }]);
      },
    };
    await collectModelEvents(
      new AnthropicMessagesAdapter({ client }).stream({
        ...request,
        items: [
          { role: 'user', content: 'inspect disk' },
          {
            type: 'assistant_tool_call',
            toolCallId: 'call-1',
            name: 'terminal_execute',
            argumentsJson: '{"command":"df -h"}',
          },
          {
            type: 'tool_result',
            toolCallId: 'call-1',
            content: '{"status":"completed"}',
            isError: false,
          },
        ],
      }),
    );

    expect(captured[0]?.messages).toEqual([
      { role: 'user', content: 'inspect disk' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call-1',
            name: 'terminal_execute',
            input: { command: 'df -h' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call-1',
            content: '{"status":"completed"}',
            is_error: false,
          },
        ],
      },
    ]);
  });

  it('retries connection setup but never retries after streaming begins', async () => {
    let setupAttempts = 0;
    const recovering = new OpenAIResponsesAdapter({
      maxAttempts: 2,
      client: {
        create: async () => {
          setupAttempts += 1;
          if (setupAttempts === 1) throw new Error('connect');
          return fixture([
            { type: 'response.output_text.delta', delta: 'ok' },
            { type: 'response.completed', response: { usage: {}, status: 'completed' } },
          ]);
        },
      },
    });
    await collectModelEvents(recovering.stream(request));
    expect(setupAttempts).toBe(2);

    let streamAttempts = 0;
    const failing = new OpenAIResponsesAdapter({
      maxAttempts: 3,
      client: {
        create: async () => {
          streamAttempts += 1;
          return (async function* () {
            yield { type: 'response.output_text.delta', delta: 'partial' };
            throw new Error('stream failed');
          })();
        },
      },
    });
    const failedEvents = await collectModelEvents(failing.stream(request));
    expect(streamAttempts).toBe(1);
    expect(failedEvents.at(-1)).toMatchObject({ type: 'provider_error', message: 'stream failed' });
  });

  it('maps max output and reasoning effort only through protocol-specific fields', async () => {
    const responses: Record<string, unknown>[] = [];
    await collectModelEvents(
      new OpenAIResponsesAdapter({
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'] as never,
        client: {
          create: async (value) => {
            responses.push(value);
            return fixture([
              { type: 'response.completed', response: { usage: {}, status: 'completed' } },
            ]);
          },
        },
      }).stream({ ...request, maxOutputTokens: 12_000, reasoningEffort: 'xhigh' as never }),
    );
    expect(responses[0]).toMatchObject({
      max_output_tokens: 12_000,
      reasoning: { effort: 'xhigh' },
    });

    const chat: Record<string, unknown>[] = [];
    await collectModelEvents(
      new OpenAIChatCompletionsAdapter({
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'] as never,
        client: {
          create: async (value) => {
            chat.push(value);
            return fixture([{ choices: [{ delta: {}, finish_reason: 'stop' }] }]);
          },
        },
      }).stream({ ...request, maxOutputTokens: 12_000, reasoningEffort: 'medium' }),
    );
    expect(chat[0]).toMatchObject({ max_tokens: 12_000, reasoning_effort: 'medium' });

    const anthropic: Record<string, unknown>[] = [];
    await collectModelEvents(
      new AnthropicMessagesAdapter({
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'] as never,
        client: {
          create: async (value) => {
            anthropic.push(value);
            return fixture([{ type: 'message_stop' }]);
          },
        },
      }).stream({ ...request, maxOutputTokens: 12_000, reasoningEffort: 'high' }),
    );
    expect(anthropic[0]).toMatchObject({
      max_tokens: 12_000,
      thinking: { type: 'enabled', budget_tokens: 8_192 },
    });
  });

  it('omits optional reasoning fields when the model does not support the selected effort', async () => {
    const captured: Record<string, unknown>[] = [];
    await collectModelEvents(
      new OpenAIChatCompletionsAdapter({
        supportedReasoningEfforts: ['medium'],
        client: {
          create: async (value) => {
            captured.push(value);
            return fixture([{ choices: [{ delta: {}, finish_reason: 'stop' }] }]);
          },
        },
      }).stream({ ...request, reasoningEffort: 'low' }),
    );
    expect(captured[0]).not.toHaveProperty('reasoning_effort');
  });
});
