import { describe, expect, it } from 'vitest';

import { FakeClock } from './fake-clock.js';

describe('FakeClock', () => {
  it('runs due timers deterministically and supports cancellation', () => {
    const clock = new FakeClock(1_000);
    const calls: string[] = [];
    const cancelled = clock.setTimeout(() => calls.push('cancelled'), 50);
    clock.setTimeout(() => calls.push('first'), 20);
    clock.setTimeout(() => calls.push('second'), 20);
    clock.clearTimeout(cancelled);

    clock.advanceBy(19);
    expect(calls).toEqual([]);
    clock.advanceBy(1);
    expect(calls).toEqual(['first', 'second']);
    clock.advanceBy(30);
    expect(calls).toEqual(['first', 'second']);
    expect(clock.now()).toBe(1_050);
  });
});
