import type { UpdateApi, UpdateState } from '../../shared/update-contracts.js';

export function createMockUpdates(
  scenario: string | null,
  sessionIds: () => string[],
  onInstall: () => void,
): UpdateApi {
  const candidate = {
    id: 'mock-update',
    version: '0.6.0',
    releaseNotes: '改进终端会话体验与应用更新。\n修复下载失败后的重试。',
  };
  let state: UpdateState = {
    phase:
      scenario === 'available'
        ? 'available'
        : scenario === 'ready'
          ? 'ready'
          : scenario === 'error'
            ? 'error'
            : 'idle',
    currentVersion: '0.5.1',
    automaticChecks: true,
    lastCheckedAt: null,
    candidate: ['available', 'ready'].includes(scenario ?? '') ? candidate : null,
    progress: null,
    unsupportedReason: null,
    error: scenario === 'error' ? { stage: 'check', message: '检查更新失败，请稍后重试。' } : null,
  };
  const listeners = new Set<(value: UpdateState) => void>();
  const snapshot = (): UpdateState => structuredClone(state);
  const emit = (): UpdateState => {
    for (const listener of listeners) listener(snapshot());
    return snapshot();
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  let finishDownload: ((value: UpdateState) => void) | undefined;
  let confirmation: { id: string; sessions: string; expires: number } | undefined;
  return {
    getState: async () => snapshot(),
    setAutomaticChecks: async (enabled) => {
      state.automaticChecks = enabled;
      return emit();
    },
    check: async () => {
      state.phase = 'checking';
      emit();
      await new Promise((resolve) => setTimeout(resolve, 150));
      state = {
        ...state,
        phase: scenario === 'error' ? 'error' : scenario ? 'available' : 'idle',
        candidate: scenario && scenario !== 'error' ? candidate : null,
        lastCheckedAt: new Date().toISOString(),
      };
      return emit();
    },
    download: async (id) => {
      if (id !== state.candidate?.id) throw new Error('更新候选已变化');
      if (timer) throw new Error('正在下载');
      state = { ...state, phase: 'downloading', progress: 0, error: null };
      emit();
      return new Promise<UpdateState>((resolve) => {
        finishDownload = resolve;
        timer = setInterval(() => {
          state.progress = (state.progress ?? 0) + 25;
          if (state.progress >= 100) {
            clearInterval(timer);
            timer = undefined;
            state.phase = 'ready';
          }
          emit();
          if (state.phase === 'ready') {
            resolve(snapshot());
            finishDownload = undefined;
          }
        }, 250);
      });
    },
    cancel: async () => {
      clearInterval(timer);
      timer = undefined;
      state = { ...state, phase: 'available', progress: null };
      emit();
      finishDownload?.(snapshot());
      finishDownload = undefined;
      return snapshot();
    },
    getInstallImpact: async (id) => {
      if (state.phase !== 'ready' || id !== state.candidate?.id)
        throw new Error('更新包尚未准备好');
      confirmation = {
        id: crypto.randomUUID(),
        sessions: JSON.stringify(sessionIds().sort()),
        expires: Date.now() + 60_000,
      };
      return {
        candidateId: id,
        version: candidate.version,
        sessionCount: sessionIds().length,
        confirmationId: confirmation.id,
      };
    },
    install: async (id, confirmationId) => {
      if (
        id !== state.candidate?.id ||
        confirmation?.id !== confirmationId ||
        confirmation.expires < Date.now() ||
        confirmation.sessions !== JSON.stringify(sessionIds().sort())
      )
        throw new Error('安装确认已失效，请重新确认');
      confirmation = undefined;
      onInstall();
      state.phase = 'installing';
      return emit();
    },
    onChanged: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
