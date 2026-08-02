import { describe, expect, it } from 'vitest';

import { ERROR_CODES, errorCodeSchema, protocolErrorSchema } from './errors.js';

describe('protocol errors', () => {
  it('keeps a unique stable set of machine-readable codes', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(ERROR_CODES).toContain('stale_lease_epoch');
    expect(ERROR_CODES).toContain('approval_required');
    expect(ERROR_CODES).toContain('incompatible_protocol');
    expect(ERROR_CODES).toContain('invalid_session');
    expect(ERROR_CODES).toContain('transaction_not_found');
    expect(ERROR_CODES).toContain('local_path_outside_home');
    expect(ERROR_CODES).toContain('local_file_conflict');
    expect(ERROR_CODES).toContain('agent_loop_limit_reached');
    expect(errorCodeSchema.safeParse('made_up_error').success).toBe(false);
  });

  it('parses a strict serializable error payload', () => {
    const error = {
      code: 'session_not_found',
      message: 'Session session-1 does not exist.',
      retryable: false,
      details: { sessionId: 'session-1' },
    };

    expect(protocolErrorSchema.parse(error)).toEqual(error);
    expect(protocolErrorSchema.safeParse({ ...error, stack: 'secret stack' }).success).toBe(false);
  });
});
