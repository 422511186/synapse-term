import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { describe, expect, it } from 'vitest';

import { EmbeddedMcpServer } from './embedded-mcp-server.js';
import { generateMcpToken, type McpSettings } from './mcp-settings.js';

function createServer(settings: McpSettings): EmbeddedMcpServer {
  return new EmbeddedMcpServer({
    getSettings: () => settings,
    callTool: async (name, input) => ({ name, input }),
  });
}

describe('EmbeddedMcpServer', () => {
  it('refuses to start when disabled or tokenless', async () => {
    await expect(
      createServer({ enabled: false, approvalMode: 'read_only', port: 0 }).start(),
    ).rejects.toThrow(/未启用/);
    await expect(
      createServer({ enabled: true, approvalMode: 'read_only', port: 0 }).start(),
    ).rejects.toThrow(/token/i);
  });

  it('listens only on loopback and exposes the /mcp path', async () => {
    const token = generateMcpToken();
    const server = createServer({ enabled: true, approvalMode: 'managed', port: 0, token });
    try {
      await server.start();
      expect(server.status.running).toBe(true);
      expect(server.status.port).toBeGreaterThan(0);
      expect(server.status.connectionString).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    } finally {
      await server.stop();
    }
    expect(server.status.running).toBe(false);
  });

  it('rejects missing or invalid bearer tokens before MCP handling', async () => {
    const token = generateMcpToken();
    const server = createServer({ enabled: true, approvalMode: 'read_only', port: 0, token });
    await server.start();
    try {
      const url = server.status.connectionString!;
      expect((await fetch(url)).status).toBe(401);
      expect(
        (await fetch(url, { headers: { authorization: `Bearer wrong-token` }, method: 'POST' }))
          .status,
      ).toBe(401);
    } finally {
      await server.stop();
    }
  });

  it('registers exactly the five synapse tools over Streamable HTTP', async () => {
    const token = generateMcpToken();
    const server = createServer({ enabled: true, approvalMode: 'managed', port: 0, token });
    await server.start();
    const transport = new StreamableHTTPClientTransport(new URL(server.status.connectionString!), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    try {
      await client.connect(transport as never);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        'synapse_execute',
        'synapse_interrupt',
        'synapse_observe',
        'synapse_status',
        'synapse_wait',
      ]);
      const statusTool = tools.tools.find((tool) => tool.name === 'synapse_status');
      expect(statusTool?.description).toContain('不会触发 Probe');
      expect(statusTool?.description).toContain('synapse_execute');
    } finally {
      await client.close();
      await server.stop();
    }
  });
});
