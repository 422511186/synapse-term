import type { SessionState } from './session-state.js';

/**
 * Shared Session 标记（specs/terminal-sessions、ADR-0022）
 *
 * 仅当用户显式复制 sessionId 后，Session 对外部调用者才可寻址。
 * 复制动作不改变 Session 状态、Lease 或安全边界（D7 / D8）。
 */
export function markSessionShared(session: SessionState, sharedAt: string): SessionState {
  return { ...session, sharedAt };
}

export function isSessionShared(session: SessionState): boolean {
  return session.sharedAt !== undefined;
}
