import { describe, expect, it } from 'vitest';

import {
  composerActionReducer,
  createComposerActionState,
  getComposerAction,
} from './composer-action.js';

describe('composer action state', () => {
  it('derives a send action only when idle input is non-empty', () => {
    const state = createComposerActionState();

    expect(getComposerAction(state, '')).toMatchObject({ kind: 'send', disabled: true });
    expect(getComposerAction(state, '检查磁盘')).toMatchObject({
      kind: 'send',
      disabled: false,
    });
  });

  it('switches to stop while running even when the input is empty', () => {
    const state = composerActionReducer(createComposerActionState(), { type: 'task-started' });

    expect(getComposerAction(state, '')).toMatchObject({
      kind: 'stop',
      disabled: false,
      label: '停止',
    });
  });

  it('disables repeated stop requests until cancellation settles', () => {
    let state = composerActionReducer(createComposerActionState(), { type: 'task-started' });
    state = composerActionReducer(state, { type: 'cancel-requested' });

    expect(getComposerAction(state, '')).toMatchObject({
      kind: 'stop',
      disabled: true,
      label: '取消中…',
    });
    expect(composerActionReducer(state, { type: 'cancel-requested' })).toBe(state);

    state = composerActionReducer(state, { type: 'cancel-settled' });
    expect(getComposerAction(state, '')).toMatchObject({ kind: 'stop', disabled: false });
  });
});
