import { describe, expect, it } from 'vitest';

import { collectModelEvents, streamWithPreEventRetry, type ModelEvent } from './model-adapter.js';

describe('model adapter contract', () => {
  it('normalizes a stream into stable text, tool, usage, and completion events', async () => {
    const events: ModelEvent[] = [
      { type: 'text_delta', delta: 'hello' },
      { type: 'tool_call_started', id: 'call-1', name: 'terminal_execute' },
      { type: 'tool_call_delta', id: 'call-1', delta: '{"command":"df -h"}' },
      {
        type: 'tool_call_completed',
        id: 'call-1',
        name: 'terminal_execute',
        argumentsJson: '{"command":"df -h"}',
      },
      { type: 'usage', inputTokens: 10, outputTokens: 5 },
      { type: 'turn_completed', stopReason: 'tool_call' },
    ];

    expect(
      await collectModelEvents(
        (async function* () {
          yield* events;
        })(),
      ),
    ).toEqual(events);
  });

  it('retries only when failure happens before the first streamed event', async () => {
    let attempts = 0;
    const events = streamWithPreEventRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('connect failed');
        return (async function* () {
          yield { type: 'text_delta', delta: 'ok' } as const;
        })();
      },
      { maxAttempts: 2 },
    );

    await expect(collectModelEvents(events)).resolves.toEqual([
      { type: 'text_delta', delta: 'ok' },
    ]);
    expect(attempts).toBe(2);
  });

  it('does not retry after any event has been emitted', async () => {
    let attempts = 0;
    const events = streamWithPreEventRetry(
      async () => {
        attempts += 1;
        return (async function* () {
          yield { type: 'text_delta', delta: 'partial' } as const;
          throw new Error('stream failed');
        })();
      },
      { maxAttempts: 3 },
    );

    await expect(collectModelEvents(events)).rejects.toThrow('stream failed');
    expect(attempts).toBe(1);
  });
});
