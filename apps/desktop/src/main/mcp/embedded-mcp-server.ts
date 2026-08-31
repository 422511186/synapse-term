import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { registerMcpTools, type McpToolRuntime } from './mcp-tools.js';

export interface EmbeddedMcpServerOptions extends McpToolRuntime {
  pathname?: string | undefined;
  port?: number | undefined;
  host?: string | undefined;
}

export interface EmbeddedMcpStatus {
  running: boolean;
  port?: number | undefined;
  connectionString?: string | undefined;
}

interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

const MAX_BODY_BYTES = 1_048_576;

export class EmbeddedMcpServer {
  readonly #options: EmbeddedMcpServerOptions;
  readonly #sessions = new Map<string, McpSession>();
  #httpServer: Server | undefined;
  #port: number | undefined;

  constructor(options: EmbeddedMcpServerOptions) {
    this.#options = options;
  }

  get status(): EmbeddedMcpStatus {
    const running = this.#httpServer?.listening === true;
    return {
      running,
      ...(this.#port === undefined ? {} : { port: this.#port }),
      ...(this.#port === undefined
        ? {}
        : {
            connectionString: `http://127.0.0.1:${this.#port}${this.#options.pathname ?? '/mcp'}`,
          }),
    };
  }

  async start(preferredPort?: number): Promise<void> {
    if (this.status.running) return;
    const settings = this.#options.getSettings();
    if (!settings.enabled) throw new Error('MCP 服务未启用，请先在设置中打开开关。');
    if (settings.token === undefined) throw new Error('MCP 服务缺少访问 token，请先生成。');

    const requestedPort = preferredPort ?? settings.port ?? this.#options.port ?? 0;
    const httpServer = createServer((request, response) => {
      void this.#handleRequest(request, response);
    });
    const port = await new Promise<number>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(requestedPort, this.#options.host ?? '127.0.0.1', () => {
        httpServer.off('error', reject);
        resolve((httpServer.address() as AddressInfo).port);
      });
    }).catch(async (error) => {
      await closeHttpServer(httpServer);
      throw error;
    });
    this.#httpServer = httpServer;
    this.#port = port;
  }

  async stop(): Promise<void> {
    const httpServer = this.#httpServer;
    const sessions = [...this.#sessions.values()];
    this.#httpServer = undefined;
    this.#port = undefined;
    this.#sessions.clear();
    if (httpServer?.listening === true) await closeHttpServer(httpServer);
    for (const session of sessions) {
      await session.server.close().catch(() => undefined);
      await session.transport.close().catch(() => undefined);
    }
  }

  async #createSession(): Promise<StreamableHTTPServerTransport> {
    const settings = this.#options.getSettings();
    const authorizedToken = settings.token ?? '';
    const server = new McpServer({ name: 'synapse-term-mcp', version: '1.0.0' });
    registerMcpTools(server, this.#options, authorizedToken);
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id): void => {
        this.#sessions.set(id, { transport, server });
      },
    });
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id !== undefined) this.#sessions.delete(id);
    };
    await server.connect(transport as unknown as Transport);
    return transport;
  }

  async #handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== (this.#options.pathname ?? '/mcp')) {
      sendJson(response, 404, { error: 'Not Found' });
      return;
    }
    if (!isAuthorized(request, this.#options.getSettings().token)) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      sendJson(response, 401, { error: 'unauthorized' });
      return;
    }
    let body: unknown;
    if (request.method === 'POST') {
      try {
        body = await readJsonBody(request);
      } catch {
        sendJson(response, 400, { error: 'Invalid JSON body' });
        return;
      }
    }
    const header = request.headers['mcp-session-id'];
    const sessionId = Array.isArray(header) ? header[0] : header;
    try {
      let transport: StreamableHTTPServerTransport;
      if (request.method === 'POST' && sessionId === undefined) {
        transport = await this.#createSession();
      } else {
        const existing = sessionId === undefined ? undefined : this.#sessions.get(sessionId);
        if (existing === undefined) {
          sendJson(response, 404, { error: 'Session not found' });
          return;
        }
        transport = existing.transport;
      }
      await transport.handleRequest(request, response, body);
    } catch {
      if (!response.headersSent) sendJson(response, 500, { error: 'Internal Server Error' });
      else response.end();
    }
  }
}

async function closeHttpServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      server.closeAllConnections();
      resolve();
    }, 1_000);
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
    server.closeAllConnections();
  });
}

function isAuthorized(request: IncomingMessage, expected: string | undefined): boolean {
  if (expected === undefined) return false;
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization?.trim() ?? '');
  if (match === null) return false;
  const left = Buffer.from(match[1]!);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('payload too large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
