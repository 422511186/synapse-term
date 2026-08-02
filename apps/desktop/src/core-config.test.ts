import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildUserScopedPipeName } from '../../core/src/core-paths.js';
import { getDesktopCoreConfig } from './core-config.js';

describe('desktop Core configuration', () => {
  it('derives the same Pipe and token path as the Core', () => {
    const config = getDesktopCoreConfig(
      'C:/Users/test/AppData/Local/Terminal Agent',
      'terminal-agent',
      'test-user',
    );

    expect(config.pipeName).toBe(buildUserScopedPipeName('terminal-agent', 'test-user'));
    expect(config.tokenPath).toBe(join(config.dataDirectory, 'auth.token'));
  });

  it('uses the same short endpoint derivation as Core when a macOS temp directory is long', () => {
    const getConfig = getDesktopCoreConfig as unknown as (
      dataDirectory: string,
      appId: string,
      username: string,
      endpointOptions: { platform: 'darwin'; temporaryDirectory: string },
    ) => ReturnType<typeof getDesktopCoreConfig>;
    const buildEndpoint = buildUserScopedPipeName as unknown as (
      appId: string,
      username: string,
      endpointOptions: { platform: 'darwin'; temporaryDirectory: string },
    ) => string;
    const endpointOptions = {
      platform: 'darwin' as const,
      temporaryDirectory: `/private/var/folders/${'desktop-core-endpoint/'.repeat(10)}`,
    };

    const config = getConfig(
      '/tmp/terminal-agent-core',
      'terminal-agent',
      'test-user',
      endpointOptions,
    );

    expect(config.pipeName).toBe(buildEndpoint('terminal-agent', 'test-user', endpointOptions));
    expect(config.pipeName).toMatch(/^\/tmp\/ta-[a-f0-9]{32}\.sock$/);
  });
});
