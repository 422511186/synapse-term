import type { SessionSummary } from '../preload/preload-api.js';

export type SessionAvailabilityTone = 'error' | 'muted' | 'ready' | 'busy';

export interface SessionAvailability {
  tone: SessionAvailabilityTone;
  label: string;
}

export function getSessionAvailability(
  session: Pick<SessionSummary, 'pty' | 'shell'>,
): SessionAvailability {
  if (session.pty === 'failed') return { tone: 'error', label: '终端启动失败' };
  if (session.pty === 'exited' || session.pty === 'interrupted') {
    return { tone: 'muted', label: session.pty === 'exited' ? '终端已退出' : '终端已中断' };
  }
  if (session.pty === 'running' && session.shell === 'ready') {
    return { tone: 'ready', label: 'Shell 已就绪' };
  }
  return { tone: 'busy', label: '终端正在准备' };
}
