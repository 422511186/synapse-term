import type { SessionSummary } from '../preload/preload-api.js';

export type SessionAvailabilityTone = 'error' | 'muted' | 'ready' | 'busy';

export interface SessionAvailability {
  tone: SessionAvailabilityTone;
  label: string;
}

export function getSessionAvailability(session: Pick<SessionSummary, 'pty'>): SessionAvailability {
  if (session.pty === 'failed') return { tone: 'error', label: '终端启动失败' };
  if (session.pty === 'exited' || session.pty === 'interrupted') {
    return { tone: 'muted', label: session.pty === 'exited' ? '终端已退出' : '终端已中断' };
  }
  return session.pty === 'running'
    ? { tone: 'ready', label: '终端运行中' }
    : { tone: 'busy', label: '终端正在准备' };
}
