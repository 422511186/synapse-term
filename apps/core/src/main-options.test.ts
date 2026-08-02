import { describe, expect, it } from 'vitest';

import { parseCoreMainOptions } from './main-options.js';

describe('Core main options', () => {
  it('reads the explicit launcher contract', () => {
    expect(
      parseCoreMainOptions({
        TERMINAL_AGENT_DATA_DIR: 'C:/data',
        TERMINAL_AGENT_APP_ID: 'terminal-agent',
        TERMINAL_AGENT_USERNAME: 'test-user',
        TERMINAL_AGENT_INSTANCE_ID: 'core-1',
        TERMINAL_AGENT_VERSION: '0.1.0',
        TERMINAL_AGENT_IDLE_EXIT_MS: '2500',
      }),
    ).toEqual({
      dataDirectory: 'C:/data',
      appId: 'terminal-agent',
      username: 'test-user',
      instanceId: 'core-1',
      version: '0.1.0',
      idleExitDelayMs: 2500,
    });
  });

  it('defaults idle exit to one minute and rejects invalid values', () => {
    expect(parseCoreMainOptions({ TERMINAL_AGENT_DATA_DIR: 'C:/data' }).idleExitDelayMs).toBe(
      60_000,
    );
    expect(() =>
      parseCoreMainOptions({
        TERMINAL_AGENT_DATA_DIR: 'C:/data',
        TERMINAL_AGENT_IDLE_EXIT_MS: '-1',
      }),
    ).toThrow('TERMINAL_AGENT_IDLE_EXIT_MS');
  });

  it('requires a data directory supplied by the desktop launcher', () => {
    expect(() => parseCoreMainOptions({})).toThrow('TERMINAL_AGENT_DATA_DIR');
  });
});
