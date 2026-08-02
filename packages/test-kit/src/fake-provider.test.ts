import { describe, expect, it } from 'vitest';

import { FakeProvider } from './fake-provider.js';

describe('FakeProvider', () => {
  it('streams scripted events and records requests', async () => {
    const provider = new FakeProvider<
      { goal: string },
      { type: 'text_delta'; text: string } | { type: 'turn_completed' }
    >();
    provider.enqueueTurn([
      { type: 'text_delta', text: 'Checking disk usage.' },
      { type: 'turn_completed' },
    ]);

    const events = [];
    for await (const event of provider.stream({ goal: 'Check disk usage' })) {
      events.push(event);
    }

    expect(provider.requests).toEqual([{ goal: 'Check disk usage' }]);
    expect(events).toEqual([
      { type: 'text_delta', text: 'Checking disk usage.' },
      { type: 'turn_completed' },
    ]);
  });

  it('stops a scripted stream when its AbortSignal is cancelled', async () => {
    const provider = new FakeProvider<{ goal: string }, { type: 'text_delta'; text: string }>();
    provider.enqueueTurn([{ type: 'text_delta', text: 'first' }]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      (async () => {
        for await (const event of provider.stream({ goal: 'cancel' }, controller.signal)) {
          void event;
        }
      })(),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
