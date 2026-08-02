import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';

import { createModelConfiguration, createProviderProfile } from '@terminal-agent/domain';

import { collectModelEvents, type ModelRequest } from './model-adapter.js';
import { createProviderAdapter } from './provider-adapters.js';
import { ModelValidator } from './provider-validator.js';

interface CapturedRequest {
  authorization: string | undefined;
  body: Record<string, unknown>;
}

interface LocalProvider {
  baseUrl: string;
  requests: CapturedRequest[];
  close(): Promise<void>;
}

describe('official OpenAI SDK against a local HTTP/SSE provider', () => {
  it('probes streaming and the required provider tool call', async () => {
    await withLocalProvider(async (provider) => {
      const { profile, model } = localConfiguration(provider.baseUrl);
      const validated = await new ModelValidator().validate(
        model,
        profile,
        createProviderAdapter(profile, model, 'integration-test-key'),
      );

      expect(validated.validation).toMatchObject({
        status: 'available',
        capabilities: { responses: false, streaming: true, toolCalls: true },
      });
      expect(provider.requests).toHaveLength(1);
      expect(provider.requests[0]?.authorization).toBe('Bearer integration-test-key');
    });
  });

  it('streams a normal markdown chat response and preserves the terminal usage chunk', async () => {
    await withLocalProvider(async (provider) => {
      const { profile, model } = localConfiguration(provider.baseUrl);
      const events = await collectModelEvents(
        createProviderAdapter(profile, model, 'integration-test-key').stream({
          model: model.modelId,
          items: [{ role: 'user', content: '请简要报告状态' }],
          maxOutputTokens: 512,
          reasoningEffort: 'low',
        }),
      );

      expect(events).toEqual([
        { type: 'text_delta', delta: '## 状态\n\n' },
        { type: 'text_delta', delta: '服务正常。' },
        { type: 'usage', inputTokens: 9, outputTokens: 5 },
        { type: 'turn_completed', stopReason: 'stop' },
      ]);
      expect(provider.requests[0]?.body).toMatchObject({
        model: 'local-test-model',
        stream: true,
        max_tokens: 512,
      });
    });
  });

  it('completes a two-request tool loop without sending undeclared reasoning fields', async () => {
    await withLocalProvider(async (provider) => {
      const { profile, model } = localConfiguration(provider.baseUrl);
      const adapter = createProviderAdapter(profile, model, 'integration-test-key');
      const request: ModelRequest = {
        model: model.modelId,
        items: [{ role: 'user', content: '观察当前终端' }],
        tools: [
          {
            name: 'terminal_observe',
            description: 'Observe the current terminal output',
            inputSchema: {
              type: 'object',
              properties: { maxChars: { type: 'integer' } },
              required: ['maxChars'],
              additionalProperties: false,
            },
          },
        ],
        maxOutputTokens: 1_024,
        reasoningEffort: 'high',
      };

      const first = await collectModelEvents(adapter.stream(request));
      expect(first).toContainEqual({
        type: 'tool_call_completed',
        id: 'call-observe',
        name: 'terminal_observe',
        argumentsJson: '{"maxChars":1024}',
      });
      expect(provider.requests[0]?.body).not.toHaveProperty('reasoning_effort');

      const second = await collectModelEvents(
        adapter.stream({
          ...request,
          items: [
            ...request.items,
            {
              type: 'assistant_tool_call',
              toolCallId: 'call-observe',
              name: 'terminal_observe',
              argumentsJson: '{"maxChars":1024}',
            },
            {
              type: 'tool_result',
              toolCallId: 'call-observe',
              content: '{"content":"shell ready"}',
              isError: false,
            },
          ],
        }),
      );

      expect(second).toEqual([
        { type: 'text_delta', delta: '终端已就绪，' },
        { type: 'text_delta', delta: '没有发现错误。' },
        { type: 'usage', inputTokens: 21, outputTokens: 8 },
        { type: 'turn_completed', stopReason: 'stop' },
      ]);
      expect(provider.requests[1]?.body).toMatchObject({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'assistant' }),
          {
            role: 'tool',
            tool_call_id: 'call-observe',
            content: '{"content":"shell ready"}',
          },
        ]),
      });
    });
  });

  it('maps the official SDK HTTPS-to-HTTP cause chain to a stable Chinese diagnostic', async () => {
    await withLocalProvider(async (provider) => {
      const { profile, model } = localConfiguration(
        provider.baseUrl.replace('http://', 'https://'),
      );
      const validated = await new ModelValidator({ timeoutMs: 2_000 }).validate(
        model,
        profile,
        createProviderAdapter(profile, model, 'integration-test-key'),
      );

      expect(validated.validation).toEqual({
        status: 'unavailable',
        checkedAt: expect.any(String),
        reason:
          'url_scheme_mismatch: HTTPS 连接到了非 TLS 服务，请检查 Base URL 是否应使用 http://。',
        attempt: 1,
      });
    });
  });
});

function localConfiguration(baseUrl: string) {
  const profile = createProviderProfile({
    id: 'provider-local-http',
    name: 'Local HTTP integration provider',
    protocol: 'openai_chat_completions',
    baseUrl,
    credentialRef: 'credential:provider-local-http',
    extraHeaders: { 'x-integration-test': 'terminal-agent' },
    timeoutMs: 2_000,
  });
  const model = createModelConfiguration({
    id: 'model-local-http',
    name: 'Local HTTP integration model',
    providerProfileId: profile.id,
    modelId: 'local-test-model',
    declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
    contextWindowTokens: 16_384,
    maxOutputTokens: 2_048,
    supportedReasoningEfforts: ['low'],
    defaultReasoningEffort: 'low',
  });
  return { profile, model };
}

async function withLocalProvider(run: (provider: LocalProvider) => Promise<void>): Promise<void> {
  const provider = await startLocalProvider();
  try {
    await run(provider);
  } finally {
    await provider.close();
  }
}

async function startLocalProvider(): Promise<LocalProvider> {
  const requests: CapturedRequest[] = [];
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404).end();
        return;
      }
      const body = await readJson(request);
      requests.push({ authorization: request.headers.authorization, body });
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      streamResponse(response, body);
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: String(error) } }));
    }
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('local provider did not bind to TCP');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => close(server),
  };
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function streamResponse(response: ServerResponse, body: Record<string, unknown>) {
  const toolNames = tools(body).map((tool) => String(record(tool.function).name));
  if (toolNames.includes('provider_probe')) {
    streamToolCall(response, 'call-probe', 'provider_probe', ['{}'], 6, 2);
    return;
  }
  if (messages(body).some((message) => message.role === 'tool')) {
    streamText(response, ['终端已就绪，', '没有发现错误。'], 21, 8);
    return;
  }
  if (toolNames.includes('terminal_observe')) {
    streamToolCall(response, 'call-observe', 'terminal_observe', ['{"maxChars":', '1024}'], 12, 4);
    return;
  }
  streamText(response, ['## 状态\n\n', '服务正常。'], 9, 5);
}

function streamText(
  response: ServerResponse,
  deltas: readonly string[],
  inputTokens: number,
  outputTokens: number,
): void {
  for (const [index, content] of deltas.entries()) {
    writeSse(response, chunk({ content, ...(index === 0 ? { role: 'assistant' } : {}) }, null));
  }
  writeSse(response, chunk({}, 'stop'));
  writeUsage(response, inputTokens, outputTokens);
}

function streamToolCall(
  response: ServerResponse,
  id: string,
  name: string,
  argumentDeltas: readonly string[],
  inputTokens: number,
  outputTokens: number,
): void {
  for (const [index, argumentsJson] of argumentDeltas.entries()) {
    writeSse(
      response,
      chunk(
        {
          ...(index === 0 ? { role: 'assistant' } : {}),
          tool_calls: [
            {
              index: 0,
              ...(index === 0 ? { id, type: 'function' } : {}),
              function: {
                ...(index === 0 ? { name } : {}),
                arguments: argumentsJson,
              },
            },
          ],
        },
        null,
      ),
    );
  }
  writeSse(response, chunk({}, 'tool_calls'));
  writeUsage(response, inputTokens, outputTokens);
}

function writeUsage(response: ServerResponse, inputTokens: number, outputTokens: number): void {
  writeSse(response, {
    id: 'chatcmpl-local',
    object: 'chat.completion.chunk',
    created: 1_785_000_000,
    model: 'local-test-model',
    choices: [],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  });
  response.end('data: [DONE]\n\n');
}

function chunk(delta: Record<string, unknown>, finishReason: string | null) {
  return {
    id: 'chatcmpl-local',
    object: 'chat.completion.chunk',
    created: 1_785_000_000,
    model: 'local-test-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function writeSse(response: ServerResponse, value: unknown): void {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

function tools(body: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(body.tools) ? body.tools.map(record) : [];
}

function messages(body: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(body.messages) ? body.messages.map(record) : [];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
