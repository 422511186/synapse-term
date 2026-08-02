import { afterEach, describe, expect, it, vi } from 'vitest';

import { createToastStore } from './toast-store.js';

describe('createToastStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-dismisses success toasts after the default duration', () => {
    vi.useFakeTimers();
    const store = createToastStore();

    store.push('success', '模型已启用');

    expect(store.getSnapshot()).toHaveLength(1);
    vi.advanceTimersByTime(2_999);
    expect(store.getSnapshot()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it('keeps error toasts until manually dismissed', () => {
    vi.useFakeTimers();
    const store = createToastStore();

    store.push('error', '检测失败');
    vi.advanceTimersByTime(60_000);
    expect(store.getSnapshot()).toHaveLength(1);

    store.dismiss(store.getSnapshot()[0]!.id);
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it('merges duplicate messages and refreshes the auto-dismiss timer', () => {
    vi.useFakeTimers();
    const store = createToastStore();

    store.push('success', '模型已启用');
    vi.advanceTimersByTime(1_000);
    store.push('success', '模型已启用');

    vi.advanceTimersByTime(2_999);
    expect(store.getSnapshot()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it('caps visible toasts at three and drops the oldest', () => {
    const store = createToastStore();

    store.push('error', 'a');
    store.push('error', 'b');
    store.push('error', 'c');
    store.push('error', 'd');

    expect(store.getSnapshot().map((message) => message.text)).toEqual(['b', 'c', 'd']);
  });

  it('notifies subscribers on push and dismiss', () => {
    const store = createToastStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.push('info', 'hello');
    expect(listener).toHaveBeenCalledTimes(1);

    store.dismiss(store.getSnapshot()[0]!.id);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('returns a stable snapshot reference while unchanged', () => {
    const store = createToastStore();
    const before = store.getSnapshot();

    expect(store.getSnapshot()).toBe(before);
    store.push('info', 'x');
    expect(store.getSnapshot()).not.toBe(before);
  });
});
