import { describe, expect, it } from 'vitest';

import {
  controlEnvelopeSchema,
  eventEnvelopeSchema,
  requestEnvelopeSchema,
  responseEnvelopeSchema,
} from './envelope.js';

describe('control envelopes', () => {
  it('parses a versioned ordered event with JSON payload', () => {
    const event = {
      kind: 'event',
      id: 'message-1',
      protocolVersion: { major: 1, minor: 0 },
      sentAt: '2026-07-27T15:00:00.000Z',
      streamId: 'session-1',
      sequence: 42,
      event: 'session.state_changed',
      payload: { sessionId: 'session-1', state: 'running' },
    };

    expect(eventEnvelopeSchema.parse(event)).toEqual(event);
    expect(
      eventEnvelopeSchema.safeParse({ ...event, payload: Buffer.from('binary') }).success,
    ).toBe(false);
  });

  it('distinguishes requests and correlated success or error responses', () => {
    const common = {
      protocolVersion: { major: 1, minor: 0 },
      sentAt: '2026-07-27T15:00:00.000Z',
    };
    const request = {
      ...common,
      kind: 'request',
      id: 'request-1',
      method: 'session.create',
      payload: { profileId: 'shell-1' },
    };
    const success = {
      ...common,
      kind: 'response',
      id: 'response-1',
      requestId: 'request-1',
      ok: true,
      result: { sessionId: 'session-1' },
    };
    const failure = {
      ...common,
      kind: 'response',
      id: 'response-2',
      requestId: 'request-1',
      ok: false,
      error: {
        code: 'session_limit_reached',
        message: 'Session limit reached.',
        retryable: false,
      },
    };

    expect(requestEnvelopeSchema.parse(request)).toEqual(request);
    expect(responseEnvelopeSchema.parse(success)).toEqual(success);
    expect(responseEnvelopeSchema.parse(failure)).toEqual(failure);
    expect(controlEnvelopeSchema.parse(request)).toEqual(request);
    expect(controlEnvelopeSchema.parse(success)).toEqual(success);
  });
});
