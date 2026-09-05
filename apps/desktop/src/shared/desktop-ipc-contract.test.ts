import { describe, expect, it } from 'vitest';

import {
  DESKTOP_IPC_EVENT_CHANNELS,
  DESKTOP_IPC_REQUEST_CHANNELS,
} from './desktop-ipc-channels.js';

describe('desktop IPC contract', () => {
  it('only exposes terminal and restricted MCP channels', () => {
    expect(DESKTOP_IPC_REQUEST_CHANNELS).toEqual([
      'sessions:list',
      'sessions:environment',
      'sessions:create',
      'sessions:rename',
      'sessions:close',
      'terminal:write',
      'terminal:resize',
      'app:status',
      'settings:get-general',
      'settings:update-general',
      'theme:get-state',
      'updates:get-state',
      'updates:set-automatic-checks',
      'updates:check',
      'updates:download',
      'updates:cancel',
      'updates:install-impact',
      'updates:install',
      'mcp:get-settings',
      'mcp:update-settings',
      'mcp:regenerate-token',
      'mcp:revoke-token',
      'mcp:get-status',
      'mcp:list-shared',
      'mcp:share-session',
      'mcp:unshare-session',
      'mcp:decide-approval',
    ]);
    expect(DESKTOP_IPC_EVENT_CHANNELS).toEqual([
      'terminal:output',
      'session:changed',
      'theme:changed',
      'updates:changed',
      'mcp:approval',
      'mcp:approval-closed',
      'mcp:execution',
    ]);
  });
});
