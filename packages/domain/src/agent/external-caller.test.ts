import { describe, expect, it } from 'vitest';

import { createExternalCaller } from './external-caller.js';

describe('external caller identity', () => {
  it('creates an MCP caller identity for audit attribution', () => {
    expect(createExternalCaller('mcp', 'mcp-client')).toEqual({
      kind: 'mcp',
      id: 'mcp-client',
    });
  });

  it('creates an ACP caller identity with an optional display name', () => {
    expect(createExternalCaller('acp', 'opencode-acp', 'opencode')).toEqual({
      kind: 'acp',
      id: 'opencode-acp',
      displayName: 'opencode',
    });
  });
});
