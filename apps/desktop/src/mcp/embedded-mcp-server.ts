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
  /** 期望监听端口；start() 未显式传参时使用。占用时自动回退临时端口 */
  port?: number;
}

export interface EmbeddedMcpStatus {
  running: boolean;
  port?: number;
  connectionString?: string;
}

interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

const DEFAULT_PATHNAME = '/mcp';
const MAX_BODY_BYTES = 1_048_576;
/** stop() 中 httpServer.close 的最大等待时间，超时后强制销毁连接，避免开关永久 pending */
const HTTP_SERVER_CLOSE_TIMEOUT_MS = 3_000;

export class EmbeddedMcpServer {
  readonly #options: EmbeddedMcpServerOptions;
  #httpServer: Server | undefined;
  /** 每个 MCP 客户端会话独立的 transport + server：支持并发客户端与断线后重新初始化 */
  #sessions = new Map<string, McpSession>();
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

  /** 启动端点：要求设置已启用且存在 token，否则拒绝启动。preferredPort 被占用时回退临时端口 */
  async start(preferredPort?: number): Promise<void> {
    if (this.status.running) return;
    const settings = this.#options.getSettings();
    if (!settings.enabled) {
      throw new Error('MCP 服务未启用，请先在设置页打开开关');
    }
    if (settings.token === undefined) {
      throw new Error('MCP 服务缺少访问 token，请先生成');
    }

    const host = this.#options.host ?? '127.0.0.1';
    const requestedPort = preferredPort ?? this.#options.port ?? 0;
    try {
      this.#port = await this.#listen(host, requestedPort);
    } catch (error) {
      if (requestedPort === 0 || !isEaddrinuse(error)) throw error;
      this.#port = await this.#listen(host, 0);
    }
  }

  async #listen(host: string, port: number): Promise<number> {
    const httpServer = createServer((request, response) => {
      void this.#handleHttpRequest(request, response, this.#options.pathname ?? DEFAULT_PATHNAME);
    });
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, host, () => {
        httpServer.off('error', reject);
        resolve();
      });
    });
    this.#httpServer = httpServer;
    return (httpServer.address() as AddressInfo).port;
  }

  /** 停止端点：关闭 HTTP 服务与 MCP 会话，吊销/关闭后无残留监听 */
  async stop(): Promise<void> {
    const httpServer = this.#httpServer;
    const sessions = [...this.#sessions.values()];
    this.#httpServer = undefined;
    this.#sessions.clear();
    this.#port = undefined;
    if (httpServer !== undefined && httpServer.listening) {
      await closeHttpServerBounded(httpServer);
    }
    for (const session of sessions) {
      await session.transport.close().catch(() => undefined);
      await session.server.close().catch(() => undefined);
    }
  }

  /** 为新的初始化请求创建独立会话：transport 与 McpServer 一一对应 */
  async #createSession(): Promise<StreamableHTTPServerTransport> {
    const server = new McpServer({
      name: 'synapse-term-mcp',
      version: '1.0.0',
    });
    registerMcpTools(server, {
      request: this.#options.request,
      getSettings: this.#options.getSettings,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        this.#sessions.set(id, { transport, server });
      },
    });
    // 会话关闭（DELETE / 服务停止）时从会话表清理
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id !== undefined) this.#sessions.delete(id);
    };
    // SDK 1.30 的 Transport 接口在 exactOptionalPropertyTypes 下与
    // StreamableHTTPServerTransport 的 onclose 可空类型不完全兼容，此处显式收窄。
    await server.connect(transport as unknown as Transport);
    return transport;
  }

  async #handleHttpRequest(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<void> {
    if (this.#httpServer === undefined || !this.#httpServer.listening) {
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
    const sessionHeader = request.headers['mcp-session-id'];
    const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;

    try {
      let transport: StreamableHTTPServerTransport;
      if (request.method === 'POST' && sessionId === undefined) {
        // 新会话：初始化请求（含断线后重新初始化）使用全新 transport，
        // 注册到会话表，后续 GET/POST/DELETE 按 session id 路由。
        transport = await this.#createSession();
      } else {
        const existing = sessionId === undefined ? undefined : this.#sessions.get(sessionId);
        if (existing === undefined) {
          // 未知/过期会话：404 让客户端按 MCP Streamable HTTP 语义重新初始化
          sendJson(response, 404, { error: 'Session not found' });
          return;
        }
        transport = existing.transport;
      }
      await transport.handleRequest(request, response, parsedBody);
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 500, { error: 'Internal Server Error' });
      } else {
        try {
          response.end();
        } catch {
          // 连接已在停机/销毁过程中断开，忽略
        }
      }
      console.error('[desktop-mcp] handleRequest failed', error);
    }
  }
}

/** 有界关闭 HTTP 服务：close 回调超时后强制销毁连接并返回，避免调用方永久等待 */
function closeHttpServerBounded(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = globalThis.setTimeout(() => {
      server.closeAllConnections();
      resolve();
    }, HTTP_SERVER_CLOSE_TIMEOUT_MS);
    server.close(() => {
      globalThis.clearTimeout(timer);
      resolve();
    });
    server.closeAllConnections();
  });
}

function isEaddrinuse(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
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
