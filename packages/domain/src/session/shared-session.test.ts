import { describe, expect, it } from 'vitest';

import { createSessionState } from './session-state.js';
import { isSessionShared, markSessionShared } from './shared-session.js';

describe('shared session marker', () => {
  it('starts unshared and only becomes shared after an explicit user copy', () => {
    const session = createSessionState('session-1');
    expect(isSessionShared(session)).toBe(false);

    const shared = markSessionShared(session, '2026-08-02T00:00:00.000Z');
    expect(isSessionShared(shared)).toBe(true);
    expect(shared.sharedAt).toBe('2026-08-02T00:00:00.000Z');
  });

  it('does not change lease, attachment, or environment when marked shared', () => {
    const session = createSessionState('session-1');
    const shared = markSessionShared(session, '2026-08-02T00:00:00.000Z');

    expect(shared.lease).toEqual(session.lease);
    expect(shared.attachment).toBe(session.attachment);
    expect(shared.environment).toEqual(session.environment);
    expect(shared.shellCapabilityEpoch).toBe(session.shellCapabilityEpoch);
  });
});
