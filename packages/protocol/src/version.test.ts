import { describe, expect, it } from 'vitest';

import { CURRENT_PROTOCOL_VERSION, protocolVersionSchema } from './version.js';

describe('protocol version', () => {
  it('uses a strict numeric major and minor model', () => {
    expect(CURRENT_PROTOCOL_VERSION).toEqual({ major: 2, minor: 0 });
    expect(protocolVersionSchema.parse(CURRENT_PROTOCOL_VERSION)).toEqual(CURRENT_PROTOCOL_VERSION);
    expect(protocolVersionSchema.safeParse({ major: 1, minor: -1 }).success).toBe(false);
    expect(protocolVersionSchema.safeParse({ major: 1, minor: 0, patch: 1 }).success).toBe(false);
  });
});
