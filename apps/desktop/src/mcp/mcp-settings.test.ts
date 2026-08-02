/**
 * MCP 设置存储测试：默认值、持久化往返、字段白名单与 token 生成。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withTemporaryDirectory } from '@synapse-term/test-kit';

import {
  createMcpSettingsStore,
  generateMcpToken,
  sanitizeMcpSettings,
  type McpSettings,
} from './mcp-settings.js';

describe('McpSettingsStore', () => {
  it('returns safe defaults when the settings file does not exist', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = createMcpSettingsStore(join(directory, 'mcp'));
      await expect(store.load()).resolves.toEqual({
        enabled: false,
        approvalMode: 'read_only',
      });
    });
  });

  it('persists settings and reloads them round-trip', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = createMcpSettingsStore(join(directory, 'mcp'));
      const settings: McpSettings = {
        enabled: true,
        approvalMode: 'managed',
        token: 'test-token-value',
      };
      await store.save(settings);
      await expect(store.load()).resolves.toEqual(settings);

      // 设置文件确实落在 userData/mcp/settings.json
      const raw = await readFile(join(directory, 'mcp', 'settings.json'), 'utf8');
      expect(JSON.parse(raw)).toMatchObject({ enabled: true, approvalMode: 'managed' });
    });
  });

  it('falls back to defaults when the settings file is corrupted', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = createMcpSettingsStore(join(directory, 'mcp'));
      await store.save({ enabled: true, approvalMode: 'managed', token: 'x' });
      // 模拟手工写坏的 JSON
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(directory, 'mcp', 'settings.json'), '{not-json', 'utf8');
      await expect(store.load()).resolves.toEqual({
        enabled: false,
        approvalMode: 'read_only',
      });
    });
  });

  it('sanitizes unknown fields and invalid approval modes', () => {
    expect(
      sanitizeMcpSettings({
        enabled: 'yes',
        approvalMode: 'super_admin',
        token: '',
        extra: 'dropped',
      }),
    ).toEqual({ enabled: false, approvalMode: 'read_only' });
    expect(sanitizeMcpSettings(null)).toEqual({ enabled: false, approvalMode: 'read_only' });
    expect(sanitizeMcpSettings({ enabled: true, approvalMode: 'managed', token: 'abc' })).toEqual({
      enabled: true,
      approvalMode: 'managed',
      token: 'abc',
    });
  });

  it('generates URL-safe tokens with sufficient entropy', () => {
    const token = generateMcpToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(generateMcpToken()).not.toBe(token);
  });
});
