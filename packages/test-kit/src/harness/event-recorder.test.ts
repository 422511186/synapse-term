import { describe, expect, it } from 'vitest';

import { EventRecorder } from './event-recorder.js';

describe('EventRecorder', () => {
  it('records events in order and provides deep sequence assertions', () => {
    const recorder = new EventRecorder<{ type: string; value: number }>();
    recorder.record({ type: 'started', value: 1 });
    recorder.record({ type: 'completed', value: 2 });

    expect(recorder.events).toEqual([
      { type: 'started', value: 1 },
      { type: 'completed', value: 2 },
    ]);
    expect(() =>
      recorder.assertEvents([
        { type: 'started', value: 1 },
        { type: 'completed', value: 2 },
      ]),
    ).not.toThrow();
    expect(() => recorder.assertEvents([{ type: 'completed', value: 2 }])).toThrow();
  });
});
