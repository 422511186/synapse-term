/**
 * MCP 控制器测试：开关、审批模式、token 生成/吊销与端点生命周期。
 */
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { withTemporaryDirectory } from '@synapse-term/test-kit';

import { createMcpControllerWithStore } from './mcp-controller.js';
import { createMcpSettingsStore } from './mcp-settings.js';

describe('McpController', () => {
  it('starts with a safe default state', async () => {
    await withTemporaryDirectory(async (directory) => {
      const controller = createMcpControllerWithStore(
        createMcpSettingsStore(join(directory, 'mcp')),
        {
          settingsDirectory: join(directory, 'mcp'),
          request: vi.fn(),
        },
      );
      await expect(controller.status()).resolves.toMatchObject({
        enabled: false,
        running: false,
        approvalMode: 'read_only',
        hasToken: false,
      });
      await controller.dispose();
    });
  });

  it('enabling generates a token, starts the loopback endpoint and persists settings', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = createMcpSettingsStore(join(directory, 'mcp'));
      const controller = createMcpControllerWithStore(store, {
        settingsDirectory: join(directory, 'mcp'),
        request: vi.fn(),
      });

      const enabled = await controller.setEnabled(true);
      expect(enabled).toMatchObject({
        enabled: true,
        running: true,
        hasToken: true,
      });
      expect(enabled.token).toBeDefined();
      expect(enabled.connectionString).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

      // 设置已持久化，重新加载一致
      await expect(store.load()).resolves.toMatchObject({
        enabled: true,
        approvalMode: 'read_only',
        token: enabled.token,
      });

      // 审批模式切换后持久化
      const managed = await controller.setApprovalMode('managed');
      expect(managed.approvalMode).toBe('managed');
      await expect(store.load()).resolves.toMatchObject({ approvalMode: 'managed' });

      // 重新生成 token：旧 token 立即失效，新调用必须携带新 token
      const regenerated = await controller.regenerateToken();
      expect(regenerated.token).not.toBe(enabled.token);
      expect(regenerated.running).toBe(true);

      await controller.dispose();
    });
  });

  it('revoking the token stops the endpoint so external calls all fail', async () => {
    await withTemporaryDirectory(async (directory) => {
      const controller = createMcpControllerWithStore(
        createMcpSettingsStore(join(directory, 'mcp')),
        {
          settingsDirectory: join(directory, 'mcp'),
          request: vi.fn(),
        },
      );
      const enabled = await controller.setEnabled(true);
      const port = enabled.port!;

      const revoked = await controller.revokeToken();
      expect(revoked).toMatchObject({ enabled: true, running: false, hasToken: false });
      await expect(
        fetch(`http://127.0.0.1:${port}/mcp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        }),
      ).rejects.toThrow();

      await controller.dispose();
    });
  });

  it('disabling the endpoint stops listening without erasing the token', async () => {
    await withTemporaryDirectory(async (directory) => {
      const controller = createMcpControllerWithStore(
        createMcpSettingsStore(join(directory, 'mcp')),
        {
          settingsDirectory: join(directory, 'mcp'),
          request: vi.fn(),
        },
      );
      const enabled = await controller.setEnabled(true);
      const port = enabled.port!;

      const disabled = await controller.setEnabled(false);
      expect(disabled).toMatchObject({ enabled: false, running: false, hasToken: true });
      await expect(fetch(`http://127.0.0.1:${port}/mcp`)).rejects.toThrow();

      // 再次启用无需重新生成 token
      const reenabled = await controller.setEnabled(true);
      expect(reenabled.running).toBe(true);
      expect(reenabled.token).toBe(enabled.token);

      await controller.dispose();
    });
  });
});
