import { describe, expect, it, vi } from 'vitest';

import { ApprovalQueue } from './approval-queue.js';

const request = {
  sessionId: 'session',
  command: 'rm -rf build',
  risk: 'destructive' as const,
  reasons: ['irreversible'],
};

describe('ApprovalQueue', () => {
  it('emits structured-cloneable requests for IPC', async () => {
    const queue = new ApprovalQueue({ idFactory: () => 'approval-id' });
    let visible: unknown;
    queue.onRequest((request) => {
      visible = request;
    });
    const pending = queue.request(request);

    expect(() => structuredClone(visible)).not.toThrow();
    queue.decide('approval-id', 'allow_once');
    await pending;
  });

  it('notifies lifecycle listeners when a card is resolved', async () => {
    const resolutions: Array<[string, string]> = [];
    const queue = new ApprovalQueue({ idFactory: () => 'approval-id' });
    queue.onResolution((id, reason) => resolutions.push([id, reason]));
    const pending = queue.request(request);
    queue.decide('approval-id', 'allow_once');
    await expect(pending).resolves.toEqual({ decision: 'allow_once', reason: 'user' });
    expect(resolutions).toEqual([['approval-id', 'user']]);
  });

  it('presents requests FIFO and resolves the visible request first', async () => {
    vi.useFakeTimers();
    try {
      const shown: string[] = [];
      const queue = new ApprovalQueue({ timeoutMs: 1_000 });
      queue.onRequest((visible) => shown.push(visible.command));
      const first = queue.request(request);
      const second = queue.request({ ...request, command: 'second' });
      await vi.advanceTimersByTimeAsync(0);
      expect(shown).toEqual(['rm -rf build']);

      expect(queue.decide(queue.current?.id ?? '', 'allow_once')).toBe(true);
      await expect(first).resolves.toEqual({ decision: 'allow_once', reason: 'user' });
      await vi.advanceTimersByTimeAsync(0);
      expect(shown).toEqual(['rm -rf build', 'second']);
      expect(queue.decide(queue.current?.id ?? '', 'denied')).toBe(true);
      await expect(second).resolves.toEqual({ decision: 'denied', reason: 'user' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out the displayed card and advances the queue', async () => {
    vi.useFakeTimers();
    try {
      const queue = new ApprovalQueue({ timeoutMs: 60_000 });
      const first = queue.request(request);
      const second = queue.request({ ...request, command: 'next' });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_000);
      await expect(first).resolves.toEqual({ decision: 'denied', reason: 'timeout' });
      await vi.advanceTimersByTimeAsync(0);
      expect(queue.current?.command).toBe('next');
      queue.decide(queue.current?.id ?? '', 'allow_session');
      await expect(second).resolves.toEqual({ decision: 'allow_session', reason: 'user' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels pending approvals immediately when the endpoint is disabled', async () => {
    const queue = new ApprovalQueue();
    const pending = queue.request(request);
    queue.cancelAll();
    await expect(pending).resolves.toEqual({ decision: 'denied', reason: 'cancelled' });
    expect(queue.current).toBeUndefined();
  });

  it('cancels current and queued approvals for one Session without affecting another', async () => {
    const queue = new ApprovalQueue({
      idFactory: (() => {
        let sequence = 0;
        return () => `approval-${++sequence}`;
      })(),
    });
    const first = queue.request(request);
    const second = queue.request({ ...request, command: 'second', sessionId: 'session' });
    const other = queue.request({ ...request, command: 'other', sessionId: 'other-session' });
    const cancelledId = queue.current?.id;

    queue.cancelSession('session');

    await expect(first).resolves.toEqual({ decision: 'denied', reason: 'cancelled' });
    await expect(second).resolves.toEqual({ decision: 'denied', reason: 'cancelled' });
    expect(cancelledId === undefined ? false : queue.decide(cancelledId, 'allow_once')).toBe(false);
    expect(queue.current?.sessionId).toBe('other-session');
    queue.decide(queue.current?.id ?? '', 'allow_once');
    await expect(other).resolves.toEqual({ decision: 'allow_once', reason: 'user' });
  });
});
