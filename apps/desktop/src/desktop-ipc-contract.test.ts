import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  DESKTOP_IPC_EVENT_CHANNELS,
  DESKTOP_IPC_REQUEST_CHANNELS,
} from './desktop-ipc-channels.js';

describe('desktop IPC contract', () => {
  it('registers every public DesktopApi request through the single Main allowlist', () => {
    const mainSource = readFileSync(new URL('./electron-main.ts', import.meta.url), 'utf8');

    expect(DESKTOP_IPC_REQUEST_CHANNELS).toEqual([
      'sessions:list',
      'sessions:environment',
      'sessions:create',
      'sessions:set-dialect',
      'sessions:close',
      'terminal:write',
      'terminal:resize',
      'terminal:replay',
      'resources:get',
      'resources:refresh',
      'agent:start',
      'agent:cancel',
      'agent:history',
      'agent:reset-conversation',
      'agent:interrupt',
      'agent:approve',
      'agent:takeover',
      'providers:list',
      'providers:save',
      'providers:discover-models',
      'providers:cancel-discovery',
      'providers:remove',
      'models:list',
      'models:save',
      'models:test',
      'models:set-enabled',
      'models:set-default',
      'models:remove',
      'models:import-discovered',
      'audit:list',
      'audit:cleanup',
      'core:status',
      'core:exit',
    ]);
    expect(mainSource).toContain("from './desktop-ipc-channels.js'");
    expect(mainSource).toContain('for (const channel of DESKTOP_IPC_REQUEST_CHANNELS)');
  });

  it('keeps the Renderer event boundary limited to declared event streams', () => {
    expect(DESKTOP_IPC_EVENT_CHANNELS).toEqual([
      'terminal:output',
      'agent:timeline',
      'session:resources',
      'session:changed',
    ]);
  });
});
