import { describe, expect, it } from 'vitest';

import {
  DESKTOP_IPC_EVENT_CHANNELS,
  DESKTOP_IPC_REQUEST_CHANNELS,
} from './desktop-ipc-channels.js';

describe('desktop IPC contract', () => {
  it('only exposes terminal session channels', () => {
    expect(DESKTOP_IPC_REQUEST_CHANNELS).toEqual([
      'sessions:list',
      'sessions:environment',
      'sessions:create',
      'sessions:rename',
      'sessions:close',
      'terminal:write',
      'terminal:resize',
      'app:status',
    ]);
    expect(DESKTOP_IPC_EVENT_CHANNELS).toEqual(['terminal:output', 'session:changed']);
  });
});
