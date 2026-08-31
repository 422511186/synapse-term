import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createMcpSettingsStore, generateMcpToken, sanitizeMcpSettings } from './mcp-settings.js';

describe('MCP settings', () => {
  it('defaults to disabled and read-only', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'synapse-mcp-'));
    const settings = await createMcpSettingsStore(directory).load();
    expect(settings).toEqual({ enabled: false, approvalMode: 'read_only', port: 4_739 });
  });

  it('falls back to the fixed default port when the persisted port is missing or invalid', () => {
    expect(sanitizeMcpSettings({ enabled: true, approvalMode: 'managed' })).toEqual({
      enabled: true,
      approvalMode: 'managed',
      port: 4_739,
    });
    expect(sanitizeMcpSettings({ enabled: true, approvalMode: 'managed', port: 0 })).toEqual({
      enabled: true,
      approvalMode: 'managed',
      port: 4_739,
    });
  });

  it('falls back to safe defaults for corrupt JSON or unknown values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'synapse-mcp-'));
    const path = join(directory, 'settings.json');
    const store = createMcpSettingsStore(directory);
    await writeFile(path, '{enabled:true,', 'utf8');
    expect(await store.load()).toEqual({ enabled: false, approvalMode: 'read_only', port: 4_739 });

    await writeFile(
      path,
      JSON.stringify({ enabled: true, approvalMode: 'root', token: '', port: 99_999 }),
      'utf8',
    );
    expect(await store.load()).toEqual({ enabled: false, approvalMode: 'read_only', port: 4_739 });
  });

  it('sanitizes persisted fields and saves atomically enough for restart', async () => {
    expect(
      sanitizeMcpSettings({
        enabled: true,
        approvalMode: 'full',
        token: 'token',
        port: 3_000,
        attackerField: true,
      }),
    ).toEqual({ enabled: true, approvalMode: 'full', token: 'token', port: 3_000 });

    const directory = await mkdtemp(join(tmpdir(), 'synapse-mcp-'));
    const store = createMcpSettingsStore(directory);
    const settings = {
      enabled: true,
      approvalMode: 'managed',
      port: 4_739,
      token: generateMcpToken(),
    } as const;
    await store.save(settings);
    expect(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'))).toEqual(settings);
  });
});
