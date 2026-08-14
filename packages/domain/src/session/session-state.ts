export type PtyState = 'starting' | 'running' | 'exited' | 'failed' | 'interrupted';

export interface SessionState {
  id: string;
  title: string;
  terminalType: string;
  pty: PtyState;
  columns: number;
  rows: number;
}

export interface CreateSessionStateInput {
  id: string;
  title: string;
  terminalType: string;
  columns?: number;
  rows?: number;
}

export type TransitionResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function createSessionState(input: CreateSessionStateInput): SessionState {
  return {
    id: input.id,
    title: input.title,
    terminalType: input.terminalType,
    pty: 'starting',
    columns: input.columns ?? 80,
    rows: input.rows ?? 24,
  };
}

const PTY_TRANSITIONS: Record<PtyState, readonly PtyState[]> = {
  starting: ['running', 'exited', 'failed', 'interrupted'],
  running: ['exited', 'failed', 'interrupted'],
  exited: [],
  failed: [],
  interrupted: [],
};

export function transitionSessionPty(
  state: SessionState,
  next: PtyState,
): TransitionResult<SessionState> {
  if (state.pty === next) return { ok: true, value: state };
  if (!PTY_TRANSITIONS[state.pty].includes(next)) {
    return { ok: false, error: `invalid pty transition: ${state.pty} -> ${next}` };
  }
  return { ok: true, value: { ...state, pty: next } };
}

export function resizeSession(state: SessionState, columns: number, rows: number): SessionState {
  if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) {
    throw new RangeError('terminal dimensions must be positive integers');
  }
  return { ...state, columns, rows };
}
