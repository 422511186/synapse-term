/**
 * 桌面内嵌 MCP 端点（specs/mcp-access、ADR-0021）
 *
 * 以 Node HTTP 服务监听 127.0.0.1 回环地址，端点路径固定为 /mcp；
 * 每个 HTTP 请求都校验 Bearer token（读取当前设置，吊销立即生效），
 * 通过后交给 MCP SDK 的 Streamable HTTP 传输处理。
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { registerMcpTools, type McpToolRuntime } from './mcp-tools.js';

export interface EmbeddedMcpServerOptions {
  /** 同步读取当前设置：token 校验与审批模式都在请求时取最新值 */
  getSettings: McpToolRuntime['getSettings'];
  /** Core API 请求通道：通常为桌面主进程的 CoreSupervisor.request */
  request: McpToolRuntime['request'];
  /** 回环监听地址，默认仅本机 127.0.0.1 */
  host?: string;
  /** HTTP 端点路径，默认 /mcp */
  pathname?: string;
}

export interface EmbeddedMcpStatus {
  running: boolean;
  port?: number;
  connectionString?: string;
}

const DEFAULT_PATHNAME = '/mcp';
const MAX_BODY_BYTES = 1_048_576;

export class EmbeddedMcpServer {
  readonly #options: EmbeddedMcpServerOptions;
  #httpServer: Server | undefined;
  #mcpServer: McpServer | undefined;
  #transport: StreamableHTTPServerTransport | undefined;
  #port: number | undefined;

  constructor(options: EmbeddedMcpServerOptions) {
    this.#options = options;
  }

  get status(): EmbeddedMcpStatus {
    return {
      running: this.#httpServer !== undefined && this.#httpServer.listening,
      ...(this.#port === undefined ? {} : { port: this.#port }),
      ...(this.#port === undefined
        ? {}
        : {
            connectionString: `http://127.0.0.1:${this.#port}${this.#options.pathname ?? DEFAULT_PATHNAME}`,
          }),
    };
  }

  /** 启动端点：要求设置已启用且存在 token，否则拒绝启动 */
  async start(): Promise<void> {
    if (this.status.running) return;
    const settings = this.#options.getSettings();
    if (!settings.enabled) {
      throw new Error('MCP 服务未启用，请先在设置页打开开关');
    }
    if (settings.token === undefined) {
      throw new Error('MCP 服务缺少访问 token，请先生成');
    }

    const host = this.#options.host ?? '127.0.0.1';
    const pathname = this.#options.pathname ?? DEFAULT_PATHNAME;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    const mcpServer = new McpServer({
      name: 'synapse-term-mcp',
      version: '1.0.0',
    });
    registerMcpTools(mcpServer, {
      request: this.#options.request,
      getSettings: this.#options.getSettings,
    });

    const httpServer = createServer((request, response) => {
      void this.#handleHttpRequest(request, response, pathname);
    });
    this.#httpServer = httpServer;
    this.#mcpServer = mcpServer;
    this.#transport = transport;

    // SDK 1.30 的 Transport 接口在 exactOptionalPropertyTypes 下与
    // StreamableHTTPServerTransport 的 onclose 可空类型不完全兼容，此处显式收窄。
    await mcpServer.connect(transport as unknown as Transport);
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(0, host, () => {
        httpServer.off('error', reject);
        resolve();
      });
    });
    this.#port = (httpServer.address() as AddressInfo).port;
  }

  /** 停止端点：关闭 HTTP 服务与 MCP 会话，吊销/关闭后无残留监听 */
  async stop(): Promise<void> {
    const httpServer = this.#httpServer;
    const mcpServer = this.#mcpServer;
    this.#httpServer = undefined;
    this.#mcpServer = undefined;
    this.#transport = undefined;
    this.#port = undefined;
    if (httpServer !== undefined && httpServer.listening) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections();
      });
    }
    if (mcpServer !== undefined) {
      await mcpServer.close().catch(() => undefined);
    }
  }

  async #handleHttpRequest(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<void> {
    const transport = this.#transport;
    if (transport === undefined) {
      sendJson(response, 503, { error: 'MCP 服务未运行' });
      return;
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== pathname) {
      sendJson(response, 404, { error: 'Not Found' });
      return;
    }
    if (request.method !== 'GET' && request.method !== 'POST') {
      sendJson(response, 405, { error: 'Method Not Allowed' });
      return;
    }
    // 每次请求都校验最新 token：吊销后任何新请求（含 SSE 重连）立即被拒。
    if (!isAuthorized(request, this.#options.getSettings().token)) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      sendJson(response, 401, { error: 'unauthorized' });
      return;
    }
    let parsedBody: unknown;
    if (request.method === 'POST') {
      try {
        parsedBody = await readJsonBody(request);
      } catch (error) {
        if (error instanceof Error && error.name === 'PayloadTooLargeError') {
          sendJson(response, 413, { error: 'Payload Too Large' });
          return;
        }
        sendJson(response, 400, { error: 'Invalid JSON body' });
        return;
      }
    }
    try {
      await transport.handleRequest(request, response, parsedBody);
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 500, { error: 'Internal Server Error' });
      } else {
        response.end();
      }
      console.error('[desktop-mcp] handleRequest failed', error);
    }
  }
}

/** Bearer token 校验：常量时间比较，避免时序侧信道 */
function isAuthorized(request: IncomingMessage, expected: string | undefined): boolean {
  if (expected === undefined) return false;
  const header = request.headers.authorization;
  if (typeof header !== 'string') return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match === null) return false;
  const provided = match[1]!;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        const error = new Error('payload too large');
        error.name = 'PayloadTooLargeError';
        reject(error);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (total === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      } catch {
        reject(new Error('invalid json'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
