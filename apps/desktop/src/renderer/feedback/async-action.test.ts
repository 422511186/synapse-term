import { describe, expect, it, vi } from 'vitest';

import { createAsyncAction } from './async-action.js';

describe('createAsyncAction', () => {
  it('runs the action and exposes pending state during the run', async () => {
    const runner = createAsyncAction();
    let pendingSeenDuringRun: boolean | undefined;
    let resolveAction: ((value: string) => void) | undefined;

    const result = runner.run(
      () =>
        new Promise<string>((resolve) => {
          pendingSeenDuringRun = runner.pending;
          resolveAction = resolve;
        }),
    );

    expect(runner.pending).toBe(true);
    resolveAction!('ok');
    await expect(result).resolves.toBe('ok');
    expect(pendingSeenDuringRun).toBe(true);
    expect(runner.pending).toBe(false);
  });

  it('ignores concurrent calls while in flight (leading-edge)', async () => {
    const runner = createAsyncAction();
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          globalThis.setTimeout(resolve, 20);
        }),
    );

    const first = runner.run(action);
    const second = runner.run(action);
    await Promise.all([first, second]);

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('returns undefined for ignored calls', async () => {
    const runner = createAsyncAction();
    let resolveAction: (() => void) | undefined;

    const first = runner.run(
      () =>
        new Promise<void>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const second = runner.run(() => Promise.resolve('ignored'));

    await expect(second).resolves.toBeUndefined();
    resolveAction!();
    await first;
  });

  it('calls onError and clears pending when the action rejects', async () => {
    const runner = createAsyncAction();
    const onError = vi.fn();

    await runner.run(() => Promise.reject(new Error('boom')), { onError });

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
    expect(runner.pending).toBe(false);
  });

  it('calls onSuccess with the result', async () => {
    const runner = createAsyncAction();
    const onSuccess = vi.fn();

    await runner.run(() => Promise.resolve('done'), { onSuccess });

    expect(onSuccess).toHaveBeenCalledWith('done');
  });

  it('runs again after settling', async () => {
    const runner = createAsyncAction();
    const action = vi.fn(() => Promise.resolve());

    await runner.run(action);
    await runner.run(action);

    expect(action).toHaveBeenCalledTimes(2);
  });
});
