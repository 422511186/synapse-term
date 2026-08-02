import {
  beginModelValidation,
  finishModelValidation,
  type ModelConfiguration,
  type ProviderProfile,
} from '@synapse-term/domain';

import type { ModelAdapter, ModelEvent, ModelRequest } from './model-adapter.js';

export class ModelValidator {
  readonly #now: () => Date;
  readonly #timeoutMs: number | undefined;
  readonly #inFlight = new Map<string, Promise<ModelConfiguration>>();

  constructor(options: { now?: () => Date; timeoutMs?: number } = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#timeoutMs = options.timeoutMs;
  }

  validate(
    model: ModelConfiguration,
    profile: ProviderProfile,
    adapter: ModelAdapter,
    signal?: AbortSignal,
  ): Promise<ModelConfiguration> {
    const current = this.#inFlight.get(model.id);
    if (current !== undefined) return current;
    const run = this.#validate(model, profile, adapter, signal);
    this.#inFlight.set(model.id, run);
    void run.finally(() => {
      if (this.#inFlight.get(model.id) === run) this.#inFlight.delete(model.id);
    });
    return run;
  }

  async #validate(
    model: ModelConfiguration,
    profile: ProviderProfile,
    adapter: ModelAdapter,
    signal?: AbortSignal,
  ): Promise<ModelConfiguration> {
    const validating = beginModelValidation(model);
    if (!validating.ok) throw new Error(validating.error);

    const controller = new AbortController();
    const timeoutMs = this.#timeoutMs ?? profile.timeoutMs;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const cancel = (): void => controller.abort(signal?.reason);
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });

    let streamed = false;
    let probeCompleted = false;
    let errorReason: string | undefined;
    try {
      for await (const event of adapter.stream(
        probeRequest(model.modelId, model.maxOutputTokens),
        controller.signal,
      )) {
        if (isStreamingEvidence(event)) streamed = true;
        if (
          event.type === 'tool_call_completed' &&
          event.name === 'provider_probe' &&
          isEmptyObjectJson(event.argumentsJson)
        ) {
          probeCompleted = true;
        }
        if (event.type === 'provider_error') {
          errorReason = diagnoseProviderError(profile, event.code, event.message);
          break;
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        errorReason = timedOut
          ? providerDiagnostic('provider_timeout')
          : providerDiagnostic('provider_cancelled');
      } else {
        errorReason = diagnoseProviderError(
          profile,
          errorCode(error),
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }

    if (errorReason === undefined && controller.signal.aborted) {
      errorReason = timedOut
        ? providerDiagnostic('provider_timeout')
        : providerDiagnostic('provider_cancelled');
    }
    if (errorReason === undefined && !streamed) {
      errorReason = providerDiagnostic('provider_stream_missing');
    }
    if (errorReason === undefined && !probeCompleted) {
      errorReason = providerDiagnostic('provider_tool_call_missing');
    }

    const outcome =
      errorReason === undefined
        ? {
            status: 'available' as const,
            checkedAt: this.#now().toISOString(),
            capabilities: {
              responses: profile.protocol === 'openai_responses',
              streaming: true,
              toolCalls: true,
              ...(model.declaredCapabilities.reasoning === undefined
                ? {}
                : { reasoning: model.declaredCapabilities.reasoning }),
            },
          }
        : {
            status: 'unavailable' as const,
            checkedAt: this.#now().toISOString(),
            reason: errorReason,
          };
    const finished = finishModelValidation(validating.value, outcome);
    if (!finished.ok) throw new Error(finished.error);
    return finished.value;
  }
}

export { ModelValidator as ProviderValidator };

function probeRequest(model: string, maxOutputTokens: number): ModelRequest {
  return {
    model,
    items: [
      {
        role: 'user',
        content: 'Call the provider_probe tool exactly once with an empty object.',
      },
    ],
    tools: [
      {
        name: 'provider_probe',
        description: 'Checks streaming tool-call support.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
    ],
    maxOutputTokens,
  };
}

function isStreamingEvidence(event: ModelEvent): boolean {
  return (
    event.type === 'text_delta' ||
    event.type === 'tool_call_started' ||
    event.type === 'tool_call_delta' ||
    event.type === 'tool_call_completed'
  );
}

function isEmptyObjectJson(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as unknown;
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 0
    );
  } catch {
    return false;
  }
}

function diagnoseProviderError(profile: ProviderProfile, code: string, message: string): string {
  const evidence = `${code} ${message}`.toLocaleLowerCase('en-US');
  if (
    isLoopbackHttps(profile.baseUrl) &&
    /(eproto|err_ssl_wrong_version_number|wrong version number|unknown protocol|packet length too long)/.test(
      evidence,
    )
  ) {
    return providerDiagnostic('url_scheme_mismatch');
  }
  if (/(401|403|authentication|unauthorized|invalid.*key)/.test(evidence)) {
    return providerDiagnostic('authentication_failed');
  }
  if (/(404|model.*not.*found|unknown model)/.test(evidence)) {
    return providerDiagnostic('model_not_found');
  }
  if (/(econnrefused|enotfound|ehostunreach|connection|socket)/.test(evidence)) {
    return providerDiagnostic('provider_connection_failed');
  }
  const normalizedCode = code.length > 0 ? code : 'provider_error';
  return `${normalizedCode}: 模型服务返回错误：${message.slice(0, 500)}`;
}

function providerDiagnostic(
  code:
    | 'authentication_failed'
    | 'model_not_found'
    | 'provider_cancelled'
    | 'provider_connection_failed'
    | 'provider_stream_missing'
    | 'provider_timeout'
    | 'provider_tool_call_missing'
    | 'url_scheme_mismatch',
): string {
  switch (code) {
    case 'authentication_failed':
      return `${code}: 鉴权失败，请检查 API Key、访问权限和额外请求头。`;
    case 'model_not_found':
      return `${code}: 模型不存在或当前凭据无权访问，请检查模型名称。`;
    case 'provider_cancelled':
      return `${code}: 模型服务检测已取消。`;
    case 'provider_connection_failed':
      return `${code}: 无法连接模型服务，请检查 Base URL、网络和代理设置。`;
    case 'provider_stream_missing':
      return `${code}: 模型服务未返回可用的流式事件。`;
    case 'provider_timeout':
      return `${code}: 模型服务检测超时，请检查网络、地址或增大超时时间。`;
    case 'provider_tool_call_missing':
      return `${code}: 模型未按要求调用 provider_probe，当前端点不能用于 Agent 工具执行。`;
    case 'url_scheme_mismatch':
      return `${code}: HTTPS 连接到了非 TLS 服务，请检查 Base URL 是否应使用 http://。`;
  }
}

function isLoopbackHttps(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '[::1]' ||
        url.hostname === '::1')
    );
  } catch {
    return false;
  }
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) return String(error.code);
  return 'provider_error';
}
