import { describe, expect, it } from 'vitest';

import { createModelConfiguration, createProviderProfile } from '@terminal-agent/domain';
import { FakeProvider } from '@terminal-agent/test-kit';

import type { ModelAdapter, ModelEvent, ModelRequest } from './model-adapter.js';
import { ModelValidator } from './provider-validator.js';

const profile = createProviderProfile({
  id: 'provider-1',
  name: 'Compatible',
  protocol: 'openai_chat_completions',
  baseUrl: 'https://llm.example.test/v1',
  credentialRef: 'credential:provider-1',
  extraHeaders: {},
  timeoutMs: 30_000,
});
const model = createModelConfiguration({
  id: 'model-1',
  name: 'Model 1',
  providerProfileId: profile.id,
  modelId: 'model-1',
  declaredCapabilities: { responses: false, streaming: true, toolCalls: true },
});

describe('ModelValidator', () => {
  it('records capabilities observed from a real streamed turn', async () => {
    const adapter = new FakeProvider<ModelRequest, ModelEvent>();
    adapter.enqueueTurn([
      { type: 'tool_call_started', id: 'call-1', name: 'provider_probe' },
      { type: 'tool_call_completed', id: 'call-1', name: 'provider_probe', argumentsJson: '{}' },
      { type: 'usage', inputTokens: 1, outputTokens: 1 },
      { type: 'turn_completed', stopReason: 'tool_call' },
    ]);
    const validator = new ModelValidator({ now: () => new Date('2026-07-27T00:00:00.000Z') });

    await expect(validator.validate(model, profile, adapter)).resolves.toMatchObject({
      validation: {
        status: 'available',
        capabilities: { responses: false, streaming: true, toolCalls: true },
      },
    });
    expect(adapter.requests[0]).toMatchObject({ maxOutputTokens: model.maxOutputTokens });
  });

  it('marks provider errors unavailable without trusting declared capabilities', async () => {
    const adapter = new FakeProvider<ModelRequest, ModelEvent>();
    adapter.enqueueTurn([
      {
        type: 'provider_error',
        code: 'authentication_failed',
        message: 'bad key',
        retryable: false,
      },
    ]);
    const validator = new ModelValidator();

    await expect(validator.validate(model, profile, adapter)).resolves.toMatchObject({
      validation: {
        status: 'unavailable',
        reason: 'authentication_failed: 鉴权失败，请检查 API Key、访问权限和额外请求头。',
      },
    });
  });

  it('requires a completed provider_probe call instead of trusting arbitrary stream events', async () => {
    const adapter = new FakeProvider<ModelRequest, ModelEvent>();
    adapter.enqueueTurn([
      { type: 'tool_call_started', id: 'call-wrong', name: 'another_tool' },
      {
        type: 'tool_call_completed',
        id: 'call-wrong',
        name: 'another_tool',
        argumentsJson: '{}',
      },
      { type: 'turn_completed', stopReason: 'tool_call' },
    ]);

    await expect(new ModelValidator().validate(model, profile, adapter)).resolves.toMatchObject({
      validation: {
        status: 'unavailable',
        reason:
          'provider_tool_call_missing: 模型未按要求调用 provider_probe，当前端点不能用于 Agent 工具执行。',
      },
    });
  });

  it('applies a total timeout and maps HTTPS handshake failures to a URL scheme diagnostic', async () => {
    const hanging: ModelAdapter = {
      async *stream(_request, signal) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 60_000);
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
        });
        yield { type: 'turn_completed', stopReason: 'unexpected-timeout-resolution' };
      },
    };
    await expect(
      new ModelValidator({ timeoutMs: 20 }).validate(model, profile, hanging),
    ).resolves.toMatchObject({
      validation: {
        status: 'unavailable',
        reason: 'provider_timeout: 模型服务检测超时，请检查网络、地址或增大超时时间。',
      },
    });

    const tls = new FakeProvider<ModelRequest, ModelEvent>();
    tls.enqueueTurn([
      {
        type: 'provider_error',
        code: 'EPROTO',
        message: 'write EPROTO wrong version number during TLS handshake',
        retryable: false,
      },
    ]);
    await expect(
      new ModelValidator().validate(
        model,
        { ...profile, baseUrl: 'https://127.0.0.1:5090/v1' },
        tls,
      ),
    ).resolves.toMatchObject({
      validation: {
        status: 'unavailable',
        reason:
          'url_scheme_mismatch: HTTPS 连接到了非 TLS 服务，请检查 Base URL 是否应使用 http://。',
      },
    });
  });

  it('shares one in-flight validation per provider profile', async () => {
    let streams = 0;
    const adapter: ModelAdapter = {
      async *stream() {
        streams += 1;
        await Promise.resolve();
        yield { type: 'tool_call_started', id: 'call-1', name: 'provider_probe' };
        yield {
          type: 'tool_call_completed',
          id: 'call-1',
          name: 'provider_probe',
          argumentsJson: '{}',
        };
      },
    };
    const validator = new ModelValidator();

    const [first, second] = await Promise.all([
      validator.validate(model, profile, adapter),
      validator.validate(model, profile, adapter),
    ]);

    expect(streams).toBe(1);
    expect(first).toEqual(second);
  });
});
