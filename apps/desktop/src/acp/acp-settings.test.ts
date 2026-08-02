/**
 * ACP 设置存储测试：默认值、持久化往返、损坏回退与字段白名单。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withTemporaryDirectory } from '@synapse-term/test-kit';

import { createAcpSettingsStore, sanitizeAcpSettings, type AcpSettings } from './acp-settings.js';

describe('AcpSettingsStore', () => {
  it('returns safe defaults when the settings file does not exist', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = createAcpSettingsStore(join(directory, 'acp'));
      await expect(store.load()).resolves.toEqual({
        enabled: false,
        approvalMode: 'managed',
      });
    });
  });

  it('persists settings and reloads them round-trip', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = createAcpSettingsStore(join(directory, 'acp'));
      const settings: AcpSettings = {
        enabled: true,
        approvalMode: 'manual',
      };
      await store.save(settings);
      await expect(store.load()).resolves.toEqual(settings);

      // 设置文件确实落在 userData/acp/settings.json
      const raw = await readFile(join(directory, 'acp', 'settings.json'), 'utf8');
      expect(JSON.parse(raw)).toMatchObject({ enabled: true, approvalMode: 'manual' });
    });
  });

  it('falls back to safe defaults when the settings file is corrupted', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = createAcpSettingsStore(join(directory, 'acp'));
      await store.save({ enabled: true, approvalMode: 'managed' });
      await writeFile(join(directory, 'acp', 'settings.json'), '{not-json', 'utf8');
      await expect(store.load()).resolves.toEqual({
        enabled: false,
        approvalMode: 'managed',
      });
    });
  });

  it('sanitizes unknown fields and invalid approval modes to defaults', () => {
    expect(
      sanitizeAcpSettings({
        enabled: 'yes',
        approvalMode: 'full_access',
        extra: 'dropped',
      }),
    ).toEqual({ enabled: false, approvalMode: 'managed' });
    expect(sanitizeAcpSettings(null)).toEqual({ enabled: false, approvalMode: 'managed' });
    expect(sanitizeAcpSettings({ enabled: true, approvalMode: 'manual' })).toEqual({
      enabled: true,
      approvalMode: 'manual',
    });
  });
});
