import type { SessionState } from './session-state.js';

/**
 * Shared Session 标记（specs/mcp-access、ADR-0014）
 *
 * 仅当用户显式复制 sessionId 后，Session 对外部调用者才可寻址。
 * 复制动作不改变 Session 的 PTY 状态或安全边界。
 */
export function markSessionShared(session: SessionState, sharedAt: string): SessionState {
  return { ...session, sharedAt };
}

export function clearSessionShared(session: SessionState): SessionState {
  const { sharedAt: _removed, ...rest } = session;
  void _removed;
  return rest;
}

export function isSessionShared(session: SessionState): boolean {
  return session.sharedAt !== undefined;
}
