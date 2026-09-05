import { describe, expect, it } from 'vitest';

import * as api from './index.js';

describe('mcp-runtime public API', () => {
  it('exposes the MCP composition roots and required assembly contracts', () => {
    expect(typeof api.McpController).toBe('function');
    expect(typeof api.EmbeddedMcpServer).toBe('function');
    expect(typeof api.ApprovalQueue).toBe('function');
    expect(typeof api.createMcpSettingsStore).toBe('function');
  });

  it('keeps policy and output implementation modules private', () => {
    expect('ExternalToolPipeline' in api).toBe(false);
    expect('PolicyEngine' in api).toBe(false);
    expect('SharingOutputHistory' in api).toBe(false);
    expect('SecretRedactor' in api).toBe(false);
    expect('InputEncoderError' in api).toBe(false);
  });
});
