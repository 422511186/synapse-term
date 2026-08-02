import { describe, expect, it } from 'vitest';

import { CorrelationTracker } from './correlation.js';

const common = {
  protocolVersion: { major: 1, minor: 0 },
  sentAt: '2026-07-27T15:00:00.000Z',
};

describe('message correlation', () => {
  it('matches each response to one pending request exactly once', () => {
    const request = {
      ...common,
      kind: 'request' as const,
      id: 'request-1',
      method: 'session.create',
      payload: { profileId: 'shell-1' },
    };
    const response = {
      ...common,
      kind: 'response' as const,
      id: 'response-1',
      requestId: 'request-1',
      ok: true as const,
      result: { sessionId: 'session-1' },
    };
    const tracker = new CorrelationTracker();

    expect(tracker.trackRequest(request)).toEqual({ ok: true });
    expect(tracker.pendingRequestCount).toBe(1);
    expect(tracker.acceptResponse(response)).toEqual({ ok: true, request });
    expect(tracker.pendingRequestCount).toBe(0);
    expect(tracker.acceptResponse(response)).toEqual({
      ok: false,
      error: 'request_not_found',
    });
  });

  it('does not replace a pending request with a duplicate ID', () => {
    const request = {
      ...common,
      kind: 'request' as const,
      id: 'request-1',
      method: 'session.create',
      payload: { profileId: 'shell-1' },
    };
    const tracker = new CorrelationTracker();

    expect(tracker.trackRequest(request)).toEqual({ ok: true });
    expect(tracker.trackRequest({ ...request, method: 'session.close' })).toEqual({
      ok: false,
      error: 'invalid_message',
    });
  });

  it('detects duplicate, out-of-order, and gapped event sequences per stream', () => {
    const tracker = new CorrelationTracker();
    const event = {
      ...common,
      kind: 'event' as const,
      id: 'event-10',
      streamId: 'session-1',
      sequence: 10,
      event: 'terminal.output',
      payload: { cursor: 10 },
    };

    expect(tracker.acceptEvent(event)).toEqual({ ok: true, status: 'accepted' });
    expect(tracker.acceptEvent(event)).toEqual({ ok: true, status: 'duplicate' });
    expect(tracker.acceptEvent({ ...event, id: 'event-9', sequence: 9 })).toEqual({
      ok: false,
      error: 'invalid_message',
      lastSequence: 10,
      receivedSequence: 9,
    });
    expect(tracker.acceptEvent({ ...event, id: 'event-12', sequence: 12 })).toEqual({
      ok: false,
      error: 'history_gap',
      expectedSequence: 11,
      receivedSequence: 12,
    });
  });
});
