export type ComposerActionPhase = 'idle' | 'running' | 'cancelling';

export interface ComposerActionState {
  phase: ComposerActionPhase;
}

export type ComposerActionEvent =
  | { type: 'task-started' }
  | { type: 'task-ended' }
  | { type: 'cancel-requested' }
  | { type: 'cancel-settled' };

export type ComposerAction = {
  kind: 'send' | 'stop';
  disabled: boolean;
  label: string;
};

export function createComposerActionState(): ComposerActionState {
  return { phase: 'idle' };
}

export function composerActionReducer(
  state: ComposerActionState,
  event: ComposerActionEvent,
): ComposerActionState {
  switch (event.type) {
    case 'task-started':
      return state.phase === 'running' ? state : { phase: 'running' };
    case 'task-ended':
      return state.phase === 'idle' ? state : { phase: 'idle' };
    case 'cancel-requested':
      return state.phase === 'running' ? { phase: 'cancelling' } : state;
    case 'cancel-settled':
      return state.phase === 'cancelling' ? { phase: 'running' } : state;
  }
}

export function getComposerAction(state: ComposerActionState, input: string): ComposerAction {
  if (state.phase === 'idle') {
    return { kind: 'send', disabled: input.trim().length === 0, label: '发送' };
  }
  if (state.phase === 'cancelling') {
    return { kind: 'stop', disabled: true, label: '取消中…' };
  }
  return { kind: 'stop', disabled: false, label: '停止' };
}
