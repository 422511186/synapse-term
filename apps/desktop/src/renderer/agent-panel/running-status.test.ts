import { describe, expect, it } from 'vitest';

import { formatRunningDuration, shouldShowThinkingPlaceholder } from './running-status.js';

describe('formatRunningDuration', () => {
  it('shows 刚刚 for sub-second durations', () => {
    expect(formatRunningDuration(1_000, 1_499)).toBe('刚刚');
  });

  it('shows plain seconds under a minute', () => {
    expect(formatRunningDuration(1_000, 13_000)).toBe('12s');
  });

  it('shows minutes and seconds', () => {
    expect(formatRunningDuration(1_000, 3 * 60_000 + 6_000)).toBe('3m 05s');
  });

  it('shows hours and minutes', () => {
    expect(formatRunningDuration(1_000, 2 * 3_600_000 + 61_000)).toBe('2h 01m');
  });
});

describe('shouldShowThinkingPlaceholder', () => {
  it('shows when the turn is active and no activity arrived yet', () => {
    expect(shouldShowThinkingPlaceholder(true, false)).toBe(true);
  });

  it('hides once activity arrived', () => {
    expect(shouldShowThinkingPlaceholder(true, true)).toBe(false);
  });

  it('hides when the turn is not active', () => {
    expect(shouldShowThinkingPlaceholder(false, false)).toBe(false);
  });
});
