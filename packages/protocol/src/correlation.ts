import type { EventEnvelope, RequestEnvelope, ResponseEnvelope } from './envelope.js';

export type EventCorrelationResult =
  | { ok: true; status: 'accepted' | 'duplicate' }
  | {
      ok: false;
      error: 'invalid_message';
      lastSequence: number;
      receivedSequence: number;
    }
  | {
      ok: false;
      error: 'history_gap';
      expectedSequence: number;
      receivedSequence: number;
    };

export class CorrelationTracker {
  readonly #pendingRequests = new Map<string, RequestEnvelope>();
  readonly #eventCursors = new Map<string, { id: string; sequence: number }>();

  get pendingRequestCount(): number {
    return this.#pendingRequests.size;
  }

  trackRequest(request: RequestEnvelope): { ok: true } | { ok: false; error: 'invalid_message' } {
    if (this.#pendingRequests.has(request.id)) {
      return { ok: false, error: 'invalid_message' };
    }

    this.#pendingRequests.set(request.id, request);
    return { ok: true };
  }

  acceptResponse(
    response: ResponseEnvelope,
  ): { ok: true; request: RequestEnvelope } | { ok: false; error: 'request_not_found' } {
    const request = this.#pendingRequests.get(response.requestId);
    if (request === undefined) {
      return { ok: false, error: 'request_not_found' };
    }

    this.#pendingRequests.delete(response.requestId);
    return { ok: true, request };
  }

  acceptEvent(event: EventEnvelope): EventCorrelationResult {
    const cursor = this.#eventCursors.get(event.streamId);
    if (cursor === undefined) {
      this.#eventCursors.set(event.streamId, { id: event.id, sequence: event.sequence });
      return { ok: true, status: 'accepted' };
    }

    if (event.id === cursor.id && event.sequence === cursor.sequence) {
      return { ok: true, status: 'duplicate' };
    }

    if (event.sequence <= cursor.sequence || event.id === cursor.id) {
      return {
        ok: false,
        error: 'invalid_message',
        lastSequence: cursor.sequence,
        receivedSequence: event.sequence,
      };
    }

    const expectedSequence = cursor.sequence + 1;
    if (event.sequence !== expectedSequence) {
      return {
        ok: false,
        error: 'history_gap',
        expectedSequence,
        receivedSequence: event.sequence,
      };
    }

    this.#eventCursors.set(event.streamId, { id: event.id, sequence: event.sequence });
    return { ok: true, status: 'accepted' };
  }
}
