import { describe, expect, it } from 'vitest';

import {
  appendSentPrompt,
  buildPromptHistory,
  movePromptHistory,
} from './composer-prompt-history.js';

const emptyState = { index: undefined, draft: undefined };

describe('composer prompt history', () => {
  it('appends sent prompts and moves repeats to the most recent position', () => {
    expect(appendSentPrompt([], ' first ')).toEqual(['first']);
    expect(appendSentPrompt(['second', 'first'], 'first')).toEqual(['first', 'second']);
    expect(appendSentPrompt(['first', 'second'], 'third')).toEqual(['third', 'first', 'second']);
  });

  it('does not navigate when there is no sent message history', () => {
    expect(movePromptHistory('previous', [], '', emptyState)).toBeUndefined();
    expect(movePromptHistory('next', [], '', emptyState)).toBeUndefined();
  });

  it('builds newest-first history from persisted old-to-new turns', () => {
    expect(buildPromptHistory(undefined, ['first', 'second', 'third'])).toEqual([
      'third',
      'second',
      'first',
    ]);
    expect(buildPromptHistory(['third', 'first'], ['first', 'second', 'third'])).toEqual([
      'third',
      'first',
      'second',
    ]);
  });

  it('walks previous sent messages and restores the draft when returning', () => {
    const history = ['second', 'first'];
    const newest = movePromptHistory('previous', history, 'draft', emptyState)!;

    expect(newest).toEqual({
      input: 'second',
      state: { index: 0, draft: 'draft' },
    });

    const older = movePromptHistory('previous', history, 'second', newest.state)!;
    expect(older).toEqual({
      input: 'first',
      state: { index: 1, draft: 'draft' },
    });

    const newer = movePromptHistory('next', history, 'first', older.state)!;
    expect(newer.input).toBe('second');

    expect(movePromptHistory('next', history, 'second', newer.state)).toEqual({
      input: 'draft',
      state: { index: undefined, draft: undefined },
    });
  });

  it('does not move forward until the user has navigated back', () => {
    expect(movePromptHistory('next', ['first'], '', emptyState)).toBeUndefined();
  });
});
