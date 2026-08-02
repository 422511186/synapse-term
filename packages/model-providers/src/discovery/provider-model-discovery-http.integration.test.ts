import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';

import { createProviderProfile } from '@synapse-term/domain';

import { ProviderModelDiscoveryService } from './provider-model-discovery.js';

describe('ProviderModelDiscoveryService HTTP integration', () => {
  it('uses the official OpenAI SDK to read /v1/models with provider credentials', async () => {
    let requestUrl = '';
    let authorization = '';
    let tenant = '';
    const server = createServer((request, response) => {
      requestUrl = request.url ?? '';
      authorization = request.headers.authorization ?? '';
      tenant = String(request.headers['x-tenant'] ?? '');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'model-b', object: 'model', created: 1_700_000_000, owned_by: 'vendor' },
            { id: 'model-a', object: 'model', created: 1_700_000_100, owned_by: 'vendor' },
          ],
        }),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('missing address');
      const profile = createProviderProfile({
        id: 'provider-http',
        name: 'HTTP provider',
        protocol: 'openai_chat_completions',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        credentialRef: 'provider:provider-http',
        extraHeaders: { 'X-Tenant': 'operations' },
        timeoutMs: 5_000,
      });

      await expect(
        new ProviderModelDiscoveryService().discover(profile, 'integration-secret'),
      ).resolves.toEqual({
        models: [
          {
            id: 'model-a',
            ownedBy: 'vendor',
            createdAt: '2023-11-14T22:15:00.000Z',
          },
          {
            id: 'model-b',
            ownedBy: 'vendor',
            createdAt: '2023-11-14T22:13:20.000Z',
          },
        ],
        truncated: false,
      });
      expect(requestUrl).toBe('/v1/models');
      expect(authorization).toBe('Bearer integration-secret');
      expect(tenant).toBe('operations');
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('uses the official Anthropic SDK and follows model pagination', async () => {
    const requestUrls: string[] = [];
    let apiKey = '';
    const server = createServer((request, response) => {
      requestUrls.push(request.url ?? '');
      apiKey = String(request.headers['x-api-key'] ?? '');
      const secondPage = (request.url ?? '').includes('after_id=claude-a');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify(
          secondPage
            ? {
                data: [
                  {
                    id: 'claude-b',
                    type: 'model',
                    display_name: 'Claude B',
                    created_at: '2026-07-28T00:00:00.000Z',
                  },
                ],
                has_more: false,
                first_id: 'claude-b',
                last_id: 'claude-b',
              }
            : {
                data: [
                  {
                    id: 'claude-a',
                    type: 'model',
                    display_name: 'Claude A',
                    created_at: '2026-07-27T00:00:00.000Z',
                  },
                ],
                has_more: true,
                first_id: 'claude-a',
                last_id: 'claude-a',
              },
        ),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('missing address');
      const profile = createProviderProfile({
        id: 'provider-anthropic',
        name: 'Anthropic provider',
        protocol: 'anthropic_messages',
        baseUrl: `http://127.0.0.1:${address.port}`,
        credentialRef: 'provider:provider-anthropic',
        extraHeaders: {},
        timeoutMs: 5_000,
      });

      await expect(
        new ProviderModelDiscoveryService().discover(profile, 'anthropic-secret'),
      ).resolves.toEqual({
        models: [
          {
            id: 'claude-a',
            displayName: 'Claude A',
            createdAt: '2026-07-27T00:00:00.000Z',
          },
          {
            id: 'claude-b',
            displayName: 'Claude B',
            createdAt: '2026-07-28T00:00:00.000Z',
          },
        ],
        truncated: false,
      });
      expect(requestUrls[0]).toMatch(/^\/v1\/models/);
      expect(requestUrls).toHaveLength(2);
      expect(apiKey).toBe('anthropic-secret');
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});
